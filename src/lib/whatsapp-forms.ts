import { z } from "zod";

export type WhatsAppFormState = { error?: string; success?: string };

export function parseReminderSettings(form: FormData) {
  const offsets = form.getAll("offset_minutes").map(String).filter(Boolean);
  return z
    .object({
      enabled: z.boolean(),
      offsets: z
        .array(z.coerce.number().int().min(30).max(10080))
        .min(1)
        .max(3)
        .refine((values) => new Set(values).size === values.length),
      limit: z.coerce.number().int().min(0).max(100000),
    })
    .safeParse({
      enabled: form.get("enabled") === "on",
      offsets,
      limit:
        form.get("monthly_limit") === "" || form.get("monthly_limit") === null
          ? NaN
          : form.get("monthly_limit"),
    });
}

export const reminderStatuses: Record<string, string> = {
  claimed: "Preparando envio",
  sending: "Enviando",
  accepted: "Aceito pelo WhatsApp",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  failed: "Falha no envio",
  unknown: "Envio sem confirmação",
  canceled: "Cancelado",
  limit_reached: "Limite atingido",
};

export function reminderOffsetLabel(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} dia(s) antes`;
  if (minutes % 60 === 0) return `${minutes / 60} hora(s) antes`;
  return `${minutes} minutos antes`;
}
