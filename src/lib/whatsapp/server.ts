import "server-only";
import { z } from "zod";
import { resolveAuthOrigin } from "@/lib/auth-flow";
import { publicDatabase } from "@/lib/supabase/public";
import {
  parseConnections,
  reminderTemplate,
  type ReminderJob,
  type WhatsAppConnection,
} from "./core";
import type { ReminderRpc, SendResult } from "./processor";
import { staffNotificationTemplate, type StaffJob } from "./staff-core";

export function whatsappConnections() {
  return parseConnections(process.env.WHATSAPP_CONNECTIONS_JSON);
}

export function whatsappGatewaySecret() {
  const secret = process.env.WHATSAPP_GATEWAY_SECRET;
  if (!secret || secret.length < 32) throw new Error("WHATSAPP_NOT_CONFIGURED");
  return secret;
}

export function whatsappOrigin() {
  return resolveAuthOrigin(process.env.APP_URL, true);
}

export function getWhatsAppConnectionStatus(companyId: string): {
  configured: boolean;
  reason: string;
} {
  try {
    const connection = whatsappConnections().find(
      (item) => item.companyId === companyId,
    );
    if (!connection)
      return {
        configured: false,
        reason: "Conexão oficial do WhatsApp pendente.",
      };
    whatsappGatewaySecret();
    whatsappOrigin();
    if (
      !/^v\d{2}\.0$/.test(process.env.WHATSAPP_GRAPH_VERSION || "") ||
      !process.env.WHATSAPP_APP_SECRET ||
      process.env.WHATSAPP_APP_SECRET.length < 16 ||
      !process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN.length < 32 ||
      !process.env.CRON_SECRET ||
      process.env.CRON_SECRET.length < 32
    )
      return { configured: false, reason: "Configuração técnica incompleta." };
    if (process.env.WHATSAPP_SEND_ENABLED !== "true")
      return { configured: false, reason: "Envios pausados pela plataforma." };
    return {
      configured: true,
      reason:
        "Configuração de envio disponível. A entrega depende da Meta e do agendador em execução.",
    };
  } catch {
    return { configured: false, reason: "Configuração técnica pendente." };
  }
}

export function whatsappRpc(): ReminderRpc {
  const db = publicDatabase();
  return async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    return { data, error: error ? true : null };
  };
}

export function getStaffWhatsAppConnectionStatus(companyId: string): {
  configured: boolean;
  reason: string;
} {
  const base = getWhatsAppConnectionStatus(companyId);
  if (!base.configured) return base;
  const connection = whatsappConnections().find(
    (item) => item.companyId === companyId,
  );
  if (
    !connection?.staffDailyTemplateName ||
    !connection?.staffNewAppointmentTemplateName
  )
    return {
      configured: false,
      reason:
        "Os modelos de resumo diário e novo agendamento da equipe ainda precisam ser configurados e aprovados na Meta.",
    };
  return {
    configured: true,
    reason:
      "Configuração da equipe disponível. O envio depende das preferências, autorização do colaborador, cota e agendador em execução.",
  };
}

export async function sendWhatsAppReminder(
  connection: WhatsAppConnection,
  job: ReminderJob,
  token: string,
): Promise<SendResult> {
  return sendWhatsAppTemplate(
    connection,
    reminderTemplate(connection, job, token),
  );
}

export async function sendWhatsAppStaffNotification(
  connection: WhatsAppConnection,
  job: StaffJob,
): Promise<SendResult> {
  return sendWhatsAppTemplate(
    connection,
    staffNotificationTemplate(connection, job),
  );
}

async function sendWhatsAppTemplate(
  connection: WhatsAppConnection,
  body: unknown,
): Promise<SendResult> {
  const version = process.env.WHATSAPP_GRAPH_VERSION;
  if (
    !/^v\d{2}\.0$/.test(version || "") ||
    process.env.WHATSAPP_SEND_ENABLED !== "true"
  )
    return { status: "failed", error: "provider_rejected" };
  try {
    const response = await fetch(
      `https://graph.facebook.com/${version}/${connection.phoneNumberId}/messages`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? { status: "unknown", error: "network_unknown" }
        : { status: "failed", error: "provider_rejected" };
    const result = z
      .object({
        messages: z
          .array(z.object({ id: z.string().min(1).max(256) }))
          .length(1),
      })
      .safeParse(await response.json());
    if (!result.success) return { status: "unknown", error: "network_unknown" };
    return { status: "accepted", messageId: result.data.messages[0].id };
  } catch {
    return { status: "unknown", error: "network_unknown" };
  }
}
