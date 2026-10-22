import { z } from "zod";

export type WhatsAppFormState = { error?: string; success?: string };

export function parseStaffReminderSettings(form: FormData) {
  return z
    .object({
      dailyEnabled: z.boolean(),
      dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      newAppointmentEnabled: z.boolean(),
    })
    .safeParse({
      dailyEnabled: form.get("staff_daily_enabled") === "on",
      dailyTime: form.get("staff_daily_time"),
      newAppointmentEnabled: form.get("staff_new_appointment_enabled") === "on",
    });
}

/** The browser cannot grant consent on behalf of another staff member. */
export function parseMyStaffWhatsAppPreference(form: FormData) {
  const enabled = form.get("enabled");
  if (enabled === "no")
    return { success: true as const, data: { enabled: false, phone: null } };
  const input = z
    .object({
      enabled: z.literal("yes"),
      attestation: z.literal("on"),
      phone: z
        .string()
        .trim()
        .max(30)
        .regex(/^\+?[\d\s().-]+$/)
        .refine((value) => !value.startsWith("+") || value.startsWith("+55"))
        .transform((value) => value.replace(/\D/g, ""))
        .transform((value) =>
          value.length === 10 || value.length === 11 ? `55${value}` : value,
        )
        .pipe(z.string().regex(/^55[1-9][1-9][0-9]{8,9}$/)),
    })
    .safeParse({
      enabled,
      attestation: form.get("attestation"),
      phone: form.get("phone"),
    });
  return input.success
    ? {
        success: true as const,
        data: { enabled: true, phone: input.data.phone },
      }
    : { success: false as const };
}

export const myStaffWhatsAppPreferenceSchema = z.object({
  phone: z.string().nullable(),
  enabled: z.boolean(),
  professional_id: z.uuid().nullable(),
  professional_name: z.string().nullable(),
});

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
  queued: "Na fila de envio",
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
