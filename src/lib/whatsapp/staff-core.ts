import { z } from "zod";
import type { WhatsAppConnection } from "./core";

export const staffJobSchema = z
  .object({
    job_id: z.uuid(),
    kind: z.enum(["daily", "new_appointment"]),
    company_id: z.uuid(),
    professional_id: z.uuid(),
    professional_name: z.string().min(1).max(120),
    company_name: z.string().min(1).max(100),
    recipient: z.string().regex(/^55[1-9][1-9][0-9]{8,9}$/),
    local_date: z.iso.date(),
    part_index: z.number().int().min(1).max(1000),
    part_count: z.number().int().min(1).max(1000),
    appointments: z
      .array(
        z.object({
          appointment_id: z.uuid(),
          starts_at: z.iso.datetime({ offset: true }),
          customer_name: z.string().min(1).max(120),
          service_name: z.string().min(1).max(120),
        }),
      )
      .min(1)
      .max(2),
  })
  .refine(
    (job) =>
      job.part_index <= job.part_count &&
      (job.kind === "daily" ||
        (job.appointments.length === 1 &&
          job.part_count === 1 &&
          job.part_index === 1)),
  );
export type StaffJob = z.infer<typeof staffJobSchema>;

export function staffTemplateName(
  connection: WhatsAppConnection,
  kind: StaffJob["kind"],
) {
  return kind === "daily"
    ? connection.staffDailyTemplateName
    : connection.staffNewAppointmentTemplateName;
}

/** Each page is its own durable job and quota unit. Never drop appointments to fit a message. */
export function staffNotificationTemplate(
  connection: WhatsAppConnection,
  input: StaffJob,
) {
  const job = staffJobSchema.parse(input);
  const name = staffTemplateName(connection, job.kind);
  if (!name || job.company_id !== connection.companyId)
    throw new Error("WHATSAPP_STAFF_JOB_INVALID");
  const clean = (value: string) =>
    value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const date = job.local_date.split("-").reverse().join("/");
  const hour = (value: string) =>
    new Date(value).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  const appointment = job.appointments[0];
  const values =
    job.kind === "daily"
      ? [
          job.professional_name,
          job.company_name,
          date,
          `${job.part_index}/${job.part_count}`,
          job.appointments
            .map(
              (item) =>
                `▪ ${hour(item.starts_at)} — ${clean(item.customer_name)} · ${clean(item.service_name)}`,
            )
            .join(" | "),
        ]
      : [
          job.professional_name,
          job.company_name,
          appointment.customer_name,
          appointment.service_name,
          date,
          hour(appointment.starts_at),
        ];
  const parameters = values.map((text) => ({
    type: "text",
    text: clean(text),
  }));
  // Keep room for the approved template's fixed text within the conservative 1024-character body limit.
  if (parameters.reduce((total, item) => total + item.text.length, 0) > 820)
    throw new Error("WHATSAPP_STAFF_JOB_INVALID");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: job.recipient,
    type: "template",
    biz_opaque_callback_data: job.job_id,
    template: {
      name,
      language: { code: connection.languageCode },
      components: [{ type: "body", parameters }],
    },
  };
}
