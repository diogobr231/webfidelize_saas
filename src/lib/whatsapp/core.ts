import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const whatsappConnectionSchema = z
  .object({
    companyId: z.uuid(),
    phoneNumberId: z.string().regex(/^\d{5,30}$/),
    accessToken: z.string().min(20).max(4096),
    templateName: z.string().regex(/^[a-z][a-z0-9_]{0,511}$/),
    staffDailyTemplateName: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,511}$/)
      .optional(),
    staffNewAppointmentTemplateName: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,511}$/)
      .optional(),
    languageCode: z.enum(["pt_BR"]),
  })
  .strict();
export type WhatsAppConnection = z.infer<typeof whatsappConnectionSchema>;

/** Server configuration only. Never serialize this result into client props. */
export function parseConnections(
  value: string | undefined,
): WhatsAppConnection[] {
  if (!value) return [];
  try {
    const items = z
      .array(whatsappConnectionSchema)
      .max(100)
      .parse(JSON.parse(value));
    if (
      new Set(items.map((item) => item.companyId)).size !== items.length ||
      new Set(items.map((item) => item.phoneNumberId)).size !== items.length
    )
      throw new Error();
    return items;
  } catch {
    // Zod errors can contain rejected credentials: never return/log them.
    throw new Error("WHATSAPP_CONFIGURATION_INVALID");
  }
}

export function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function equalSecret(
  value: string | null,
  expected: string | undefined,
): boolean {
  if (!expected || expected.length < 32 || !value || value.length > 4096)
    return false;
  return timingSafeEqual(
    Buffer.from(tokenHash(value), "hex"),
    Buffer.from(tokenHash(expected), "hex"),
  );
}

export function verifyWhatsAppSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string | undefined,
): boolean {
  if (
    !secret ||
    secret.length < 16 ||
    !signature ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    createHmac("sha256", secret).update(body).digest(),
    Buffer.from(signature.slice(7), "hex"),
  );
}

export const reminderJobSchema = z.object({
  job_id: z.uuid(),
  company_id: z.uuid(),
  appointment_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  recipient: z.string().regex(/^\d{10,15}$/),
  customer_name: z.string().min(1).max(120),
  company_name: z.string().min(1).max(100),
  offset_minutes: z.number().int().min(30).max(10080),
});
export type ReminderJob = z.infer<typeof reminderJobSchema>;

export function reminderTemplate(
  connection: WhatsAppConnection,
  job: ReminderJob,
  token: string,
) {
  if (!/^[a-f0-9]{64}$/.test(token) || job.company_id !== connection.companyId)
    throw new Error("WHATSAPP_JOB_INVALID");
  const time = new Date(job.starts_at);
  const date = time.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const hour = time.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: job.recipient,
    type: "template",
    biz_opaque_callback_data: job.job_id,
    template: {
      name: connection.templateName,
      language: { code: connection.languageCode },
      components: [
        {
          type: "body",
          parameters: [job.customer_name, job.company_name, date, hour].map(
            (text) => ({ type: "text", text: clean(text) }),
          ),
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: token }],
        },
      ],
    },
  };
}

export type DeliveryEvent = {
  type: "delivery";
  companyId: string;
  jobId: string | null;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error: string | null;
};
export type OptOutEvent = { type: "optout"; companyId: string; phone: string };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** Only normalized, bounded fields leave this parser; raw webhook payloads are never stored. */
export function parseWebhookEvents(
  payload: unknown,
  connections: WhatsAppConnection[],
): (DeliveryEvent | OptOutEvent)[] {
  const root = record(payload);
  if (root.object !== "whatsapp_business_account") return [];
  const output: (DeliveryEvent | OptOutEvent)[] = [];
  for (const entry of array(root.entry))
    for (const change of array(record(entry).changes)) {
      if (record(change).field !== "messages") continue;
      const value = record(record(change).value);
      const connection = connections.find(
        (item) => item.phoneNumberId === record(value.metadata).phone_number_id,
      );
      if (!connection) continue;
      for (const item of array(value.statuses)) {
        const status = record(item);
        if (
          !["sent", "delivered", "read", "failed"].includes(
            String(status.status),
          ) ||
          typeof status.id !== "string" ||
          !status.id ||
          status.id.length > 256
        )
          continue;
        output.push({
          type: "delivery",
          companyId: connection.companyId,
          jobId: z.uuid().safeParse(status.biz_opaque_callback_data).success
            ? String(status.biz_opaque_callback_data)
            : null,
          messageId: status.id,
          status: status.status as DeliveryEvent["status"],
          error: status.status === "failed" ? "delivery_failed" : null,
        });
      }
      for (const item of array(value.messages)) {
        const message = record(item);
        const text = record(message.text).body;
        if (
          message.type === "text" &&
          typeof message.from === "string" &&
          /^\d{10,15}$/.test(message.from) &&
          typeof text === "string" &&
          /^(parar|sair|stop|cancelar lembretes)$/i.test(text.trim())
        )
          output.push({
            type: "optout",
            companyId: connection.companyId,
            phone: message.from,
          });
      }
    }
  if (output.length > 1000) throw new Error("WHATSAPP_PAYLOAD_TOO_LARGE");
  return output;
}

export async function readBoundedBody(
  request: Request,
  maxBytes = 262144,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
