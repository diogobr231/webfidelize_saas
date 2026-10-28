import { z } from "zod";
import { localAppointmentInstant, validDay } from "./scheduling";

export const classPageSize = 20;
export const classRosterPageSize = 30;
export const classSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);
export const classVersionSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(2_147_483_647);
export const classSessionFormSchema = z
  .object({
    service: z.uuid("Escolha um serviço."),
    professional: z.uuid("Escolha um profissional."),
    title: z.string().trim().min(2, "Informe o nome da turma.").max(120),
    day: z.string().refine(validDay, "Escolha uma data válida."),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Escolha um horário válido."),
    capacity: z.coerce.number().int().min(1).max(100),
    is_public: z.boolean(),
  })
  .refine((data) => Boolean(localAppointmentInstant(data.day, data.time)), {
    path: ["time"],
    message: "Este horário não existe no fuso de São Paulo.",
  });

export type ClassFormState = {
  error?: string;
  fields?: Record<string, string>;
  success?: string;
};
export type ClassChoice = {
  id: string;
  name: string;
  duration_minutes?: number;
  archived_at?: string | null;
};
export type ClassSession = {
  id: string;
  company_id: string;
  service_id: string;
  professional_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: "scheduled" | "completed" | "canceled";
  is_public: boolean;
  version: number;
};
export type ClassRegistration = {
  id: string;
  customer_id: string;
  status: "reserved" | "attended" | "canceled";
  version: number;
  customers: { name: string } | { name: string }[] | null;
};
export const classStatus = {
  scheduled: "Agendada",
  completed: "Concluída",
  canceled: "Cancelada",
};
export const registrationStatus = {
  reserved: "Inscrito",
  attended: "Presente",
  canceled: "Cancelado",
};

export function classPage(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,4}$/.test(value)
    ? Number(value)
    : 1;
}
export function classError(message: string) {
  if (message.includes("version conflict"))
    return "Esta informação mudou em outra aba. Atualize a página antes de salvar novamente.";
  if (message.includes("class full"))
    return "A turma está lotada. Nenhuma vaga adicional foi ocupada.";
  if (message.includes("already reserved"))
    return "Este cliente já possui uma inscrição ativa nesta turma.";
  if (message.includes("registration idempotency conflict"))
    return "Esta solicitação já foi usada para outra inscrição. Atualize a página antes de tentar novamente.";
  if (message.includes("class has not started"))
    return "A presença pode ser registrada somente depois do início da turma.";
  if (message.includes("class has not ended"))
    return "A turma pode ser concluída somente depois do horário final.";
  if (message.includes("class has attendance"))
    return "Já existem presenças registradas. A turma não pode ser cancelada; conclua a atividade após o horário final.";
  if (message.includes("outside business hours"))
    return "Escolha um horário dentro dos turnos cadastrados do profissional.";
  if (
    message.includes("schedule conflict") ||
    message.includes("exclusion constraint")
  )
    return "O profissional já tem um atendimento, turma ou bloqueio nesse horário. Escolha outro intervalo.";
  if (
    message.includes("not authorized") ||
    message.includes("subscription blocked")
  )
    return "Seu acesso não permite esta alteração. Consulte o proprietário da empresa.";
  if (message.includes("class booking limit"))
    return "O limite de solicitações foi atingido. Aguarde e tente novamente ou fale com a empresa.";
  if (
    message.includes("class unavailable") ||
    message.includes("registration unavailable")
  )
    return "Esta turma ou inscrição não está disponível para a alteração. Atualize a página.";
  return "Não foi possível salvar. Confira os dados e tente novamente; seus campos foram mantidos.";
}

export const publicClassSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(120),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    capacity: z.number().int().min(1).max(100),
    remaining: z.number().int().min(0).max(100),
    service: z.object({
      id: z.uuid(),
      name: z.string(),
      duration: z.number().int().positive(),
      price_cents: z.number().int().nonnegative(),
    }),
    professional: z.object({ id: z.uuid(), name: z.string() }),
  })
  .refine(
    (value) =>
      value.remaining <= value.capacity &&
      Date.parse(value.ends_at) > Date.parse(value.starts_at),
  );
export type PublicClass = z.infer<typeof publicClassSchema>;
export const publicClassReservationSchema = z.object({
  session: z.uuid(),
  request_id: z.uuid(),
  customer_name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .min(10)
    .max(30)
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().regex(/^\d{10,13}$/)),
  consent: z.literal("on"),
  website: z.literal(""),
});
export const classReceiptSchema = z
  .object({
    registration_id: z.uuid(),
    class_id: z.uuid(),
    title: z.string().min(1).max(120),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    status: z.enum(["reserved", "attended", "canceled"]),
    class_status: z.enum(["scheduled", "completed", "canceled"]),
    service_name: z.string().min(1).max(120),
    professional_name: z.string().min(1).max(120),
    company_name: z.string().min(1).max(120),
  })
  .strict()
  .refine((value) => Date.parse(value.ends_at) > Date.parse(value.starts_at));
export type ClassReceipt = z.infer<typeof classReceiptSchema>;
