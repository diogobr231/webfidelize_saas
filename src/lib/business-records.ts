import { z } from "zod";
import { appointmentTime, saoPauloDay, validDay } from "./scheduling";

export const businessSections = [
  "customers",
  "services",
  "professionals",
] as const;
export type BusinessSection = (typeof businessSections)[number];
export type ArchiveFilter = "ativos" | "arquivados" | "todos";
export const businessLabels: Record<
  BusinessSection,
  { plural: string; singular: string }
> = {
  customers: { plural: "Clientes", singular: "cliente" },
  services: { plural: "Serviços", singular: "serviço" },
  professionals: { plural: "Profissionais", singular: "profissional" },
};
export function isBusinessSection(value: unknown): value is BusinessSection {
  return (
    typeof value === "string" &&
    businessSections.includes(value as BusinessSection)
  );
}
export function archiveFilter(value: unknown): ArchiveFilter {
  return value === "arquivados" || value === "todos" ? value : "ativos";
}
export function businessListQuery(state: ArchiveFilter, search = "", page = 1) {
  return new URLSearchParams({
    estado: state,
    ...(search ? { q: search } : {}),
    pagina: String(page),
  }).toString();
}
export const businessContextSchema = z.object({
  companyId: z.uuid(),
  section: z.enum(businessSections),
  recordId: z.uuid(),
});
export type BusinessContext = z.infer<typeof businessContextSchema>;
const version = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, "Atualize a ficha antes de salvar.")
  .transform(Number)
  .refine(
    (value) => value <= 2_147_483_647,
    "Atualize a ficha antes de salvar.",
  );
const name = z
  .string("Informe o nome.")
  .trim()
  .min(2, "Informe pelo menos 2 caracteres.")
  .max(120, "Use até 120 caracteres.");
export const businessPriceSchema = z
  .string("Informe o preço em reais.")
  .trim()
  .regex(/^\d{1,6}(?:[.,]\d{1,2})?$/, "Informe o valor, por exemplo 50,00.")
  .transform((value) => {
    const [whole, decimal = ""] = value.replace(",", ".").split(".");
    return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  })
  .refine((value) => value <= 10_000_000, "O valor máximo é R$ 100.000,00.");
const common = { version, name };
export const updateBusinessRecordSchema = z.discriminatedUnion("section", [
  z.object({
    ...common,
    section: z.literal("customers"),
    phone: z.string().trim().max(30, "Use até 30 caracteres."),
  }),
  z.object({
    ...common,
    section: z.literal("services"),
    duration: z
      .string()
      .regex(/^\d{1,3}$/, "Use um número inteiro de minutos.")
      .transform(Number)
      .refine((value) => value >= 5 && value <= 480, "Use de 5 a 480 minutos."),
    price: businessPriceSchema,
  }),
  z.object({ ...common, section: z.literal("professionals") }),
]);
export const archiveBusinessRecordSchema = z.object({
  version,
  archived: z.enum(["true", "false"]).transform((value) => value === "true"),
  confirm_action: z.literal("yes", "Confirme a alteração antes de continuar."),
});
export type BusinessRecordState = {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
  feedbackKey?: string;
};
export type BusinessRecord = {
  id: string;
  name: string;
  archived_at: string | null;
  record_version: number;
  phone?: string;
  duration_minutes?: number;
  price_cents?: number;
};
export function businessRecordError(message: string) {
  if (message.includes("version conflict"))
    return "Este cadastro foi alterado em outra aba ou por outra pessoa. Seus campos foram mantidos. Abra a versão atual antes de tentar novamente.";
  if (
    message.includes("future appointments") ||
    message.includes("scheduled appointments")
  )
    return "Há agendamentos futuros ou em andamento vinculados a este cadastro. Aguarde a conclusão ou cancele esses atendimentos antes de arquivar. Remarcar para outra data futura mantém o vínculo.";
  if (message.includes("professional limit"))
    return "O limite de profissionais ativos do plano foi atingido. Libere uma vaga antes de reativar este profissional.";
  if (
    message.includes("not authorized") ||
    message.includes("subscription blocked")
  )
    return "Você não tem permissão para esta alteração ou o acesso da empresa está bloqueado.";
  if (message.includes("record archived"))
    return "Reative o cadastro antes de editar suas informações.";
  return "Não foi possível salvar a alteração. Seus dados foram mantidos; tente novamente.";
}
export function businessPriceInput(cents: number) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}
export function relatedBusinessName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation &&
    typeof relation === "object" &&
    "name" in relation &&
    typeof relation.name === "string"
    ? relation.name
    : "Cadastro indisponível";
}
/** Read the stored appointment interval, never the service's current duration. */
export function historyAppointmentTime(startsAt: string, endsAt: string) {
  if (
    !z.iso.datetime({ offset: true }).safeParse(startsAt).success ||
    !z.iso.datetime({ offset: true }).safeParse(endsAt).success
  )
    return null;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (end.getTime() <= start.getTime()) return null;
  const day = saoPauloDay(start);
  if (!validDay(day)) return null;
  return {
    day,
    date: start.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    start: appointmentTime(startsAt),
    end: appointmentTime(endsAt),
    minutes: (end.getTime() - start.getTime()) / 60_000,
  };
}
