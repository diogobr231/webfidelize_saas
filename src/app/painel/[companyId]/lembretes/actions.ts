"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  parseReminderSettings,
  parseStaffReminderSettings,
  type WhatsAppFormState,
} from "@/lib/whatsapp-forms";

export async function saveStaffReminders(
  companyId: string,
  _previous: WhatsAppFormState,
  form: FormData,
): Promise<WhatsAppFormState> {
  if (!z.uuid().safeParse(companyId).success) notFound();
  const { db } = await requireCompany(companyId, true, true);
  const input = parseStaffReminderSettings(form);
  if (!input.success)
    return { error: "Informe um horário válido para o resumo diário." };
  const { error } = await db.rpc("save_whatsapp_staff_settings", {
    p_company: companyId,
    p_daily_enabled: input.data.dailyEnabled,
    p_daily_time: input.data.dailyTime,
    p_new_enabled: input.data.newAppointmentEnabled,
  });
  if (error)
    return {
      error:
        "Não foi possível salvar os avisos da equipe. Atualize a página e tente novamente.",
    };
  revalidatePath(`/painel/${companyId}/lembretes`);
  revalidatePath(`/painel/${companyId}/meu-dia`);
  return {
    success:
      "Preferências da equipe salvas. Cada profissional precisa autorizar o próprio WhatsApp em Meu dia. Os envios dependem da conexão e da cota disponível.",
  };
}

export async function saveReminders(
  companyId: string,
  _previous: WhatsAppFormState,
  form: FormData,
): Promise<WhatsAppFormState> {
  if (!z.uuid().safeParse(companyId).success) notFound();
  const { db } = await requireCompany(companyId, true, true);
  const input = parseReminderSettings(form);
  if (!input.success)
    return {
      error:
        "Escolha até três antecedências diferentes, entre 30 minutos e 7 dias, e um limite de 0 a 100.000 mensagens.",
    };
  const { error } = await db.rpc("save_whatsapp_settings", {
    p_company: companyId,
    p_enabled: input.data.enabled,
    p_offsets: input.data.offsets,
    p_limit: input.data.limit,
  });
  if (error)
    return {
      error:
        "Não foi possível salvar os lembretes. Atualize a página e tente novamente.",
    };
  revalidatePath(`/painel/${companyId}/lembretes`);
  return {
    success:
      "Preferências salvas. Os envios dependem da conexão, da autorização do cliente e do limite disponível.",
  };
}

export async function saveCustomerWhatsAppConsent(
  companyId: string,
  customerId: string,
  _previous: WhatsAppFormState,
  form: FormData,
): Promise<WhatsAppFormState> {
  if (
    !z.uuid().safeParse(companyId).success ||
    !z.uuid().safeParse(customerId).success
  )
    notFound();
  const allowed = form.get("allowed") === "yes";
  if (!["yes", "no"].includes(String(form.get("allowed"))))
    return { error: "Selecione uma opção válida." };
  // A management role may always honor an opt-out, including after expiry.
  // Registering a new authorization still requires an active subscription.
  const { db } = await requireCompany(companyId, allowed, true);
  if (allowed && form.get("attestation") !== "on")
    return {
      error: "Confirme que o cliente autorizou os lembretes neste número.",
    };
  const { error } = await db.rpc("set_whatsapp_consent", {
    p_company: companyId,
    p_customer: customerId,
    p_allowed: allowed,
  });
  if (error)
    return {
      error:
        "Não foi possível atualizar a autorização. Confira o telefone do cadastro e tente novamente.",
    };
  revalidatePath(`/painel/${companyId}/customers/${customerId}`);
  revalidatePath(`/painel/${companyId}/lembretes`);
  return {
    success: allowed
      ? "Autorização registrada para o telefone atual do cliente."
      : "Autorização revogada. Novos lembretes não serão enviados para este cliente.",
  };
}
