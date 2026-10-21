import { z } from "zod";

export const salesStages = [
  { value: "new", label: "Novos contatos" },
  { value: "qualified", label: "Qualificados" },
  { value: "discovery", label: "Diagnóstico" },
  { value: "proposal", label: "Proposta" },
  { value: "negotiation", label: "Negociação" },
  { value: "won", label: "Fechados" },
  { value: "lost", label: "Perdidos" },
] as const;
export const salesTeamSizes = [
  { value: "solo", label: "Só eu" },
  { value: "2-5", label: "2 a 5 pessoas" },
  { value: "6-10", label: "6 a 10 pessoas" },
  { value: "11-30", label: "11 a 30 pessoas" },
  { value: "31-plus", label: "Mais de 30 pessoas" },
] as const;
export const salesBudgetRanges = [
  { value: "explore", label: "Quero entender as opções" },
  { value: "under-1000", label: "Até R$ 1.000" },
  { value: "1000-3000", label: "R$ 1.000 a R$ 3.000" },
  { value: "3000-10000", label: "R$ 3.000 a R$ 10.000" },
  { value: "over-10000", label: "Acima de R$ 10.000" },
] as const;
export const salesTimelines = [
  { value: "soon", label: "O quanto antes" },
  { value: "30-days", label: "Nos próximos 30 dias" },
  { value: "90-days", label: "Nos próximos 90 dias" },
  { value: "research", label: "Estou pesquisando" },
] as const;
export const salesDecisionRoles = [
  { value: "owner", label: "Sou proprietário(a) / sócio(a)" },
  { value: "manager", label: "Gerencio a operação" },
  { value: "team", label: "Faço parte da equipe" },
] as const;
export type SalesStage = (typeof salesStages)[number]["value"];
export type SalesActionState = {
  error?: string;
  success?: string;
  id?: string;
};
export type SalesOffer = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  niche: string | null;
  active: boolean;
  published: boolean;
  setup_price_cents: number | null;
  monthly_price_cents: number | null;
  created_at: string;
  updated_at: string;
};
export type SalesLead = {
  id: string;
  offer_id: string;
  contact_name: string;
  company_name: string;
  email: string;
  phone: string;
  niche: string;
  team_size: string;
  budget_range: string;
  timeline: string;
  decision_role: string;
  challenge: string;
  consent_at: string | null;
  source: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  stage: SalesStage;
  priority: "low" | "normal" | "high";
  setup_value_cents: number | null;
  monthly_value_cents: number | null;
  next_action: string;
  next_contact_at: string | null;
  loss_reason: string;
  version: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};
export type SalesActivity = {
  id: string;
  lead_id: string;
  actor_id: string | null;
  kind: string;
  body: string;
  created_at: string;
};
export type SalesSummary = {
  total: number;
  open: number;
  won: number;
  lost: number;
  overdue: number;
  setup_pipeline_cents: number;
  monthly_pipeline_cents: number;
  won_setup_cents: number;
  won_monthly_cents: number;
  by_stage: Record<SalesStage, number>;
};

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const salesNicheSchema = z.enum([
  "salao",
  "pet-shop",
  "clinica",
  "escritorio",
  "restaurante",
  "fornecedores",
  "logistica",
  "academia",
  "outro",
]);
export function normalizeSalesPhone(raw: string): string | null {
  if (raw.length > 30 || /[^\d\s()+.-]/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^[1-9]{2}\d{8,9}$/.test(digits)) return `55${digits}`;
  if (/^55[1-9]{2}\d{8,9}$/.test(digits)) return digits;
  return null;
}
const phoneSchema = text(10, 30)
  .transform(normalizeSalesPhone)
  .pipe(z.string());
const leadContactShape = {
  offer_id: z.uuid(),
  contact_name: text(2, 120),
  company_name: text(2, 160),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  phone: phoneSchema,
  niche: salesNicheSchema,
  team_size: z.enum(["solo", "2-5", "6-10", "11-30", "31-plus"]),
  budget_range: z.enum([
    "explore",
    "under-1000",
    "1000-3000",
    "3000-10000",
    "over-10000",
  ]),
  timeline: z.enum(["soon", "30-days", "90-days", "research"]),
  decision_role: z.enum(["owner", "manager", "team"]),
  challenge: text(10, 2000),
};
export const salesInquirySchema = z.object({
  ...leadContactShape,
  consent: z.literal("yes"),
  website: z.literal(""),
  request_id: z.uuid(),
  utm_source: text(0, 120).default(""),
  utm_medium: text(0, 120).default(""),
  utm_campaign: text(0, 120).default(""),
});
const cents = z.number().int().min(0).max(999_999_999).nullable();
export const salesOfferSchema = z
  .object({
    slug: text(3, 60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: text(3, 120),
    summary: text(10, 2000),
    niche: salesNicheSchema.nullable(),
    active: z.boolean(),
    published: z.boolean(),
    setup_price_cents: cents,
    monthly_price_cents: cents,
  })
  .refine((offer) => !offer.published || offer.active, {
    message: "Uma oferta arquivada não pode ser publicada.",
  });
const manualLeadShape = {
  ...leadContactShape,
  email: leadContactShape.email.or(z.literal("")),
  niche: salesNicheSchema.or(z.literal("")),
  team_size: leadContactShape.team_size.or(z.literal("")),
  budget_range: leadContactShape.budget_range.or(z.literal("")),
  timeline: leadContactShape.timeline.or(z.literal("")),
  decision_role: leadContactShape.decision_role.or(z.literal("")),
  challenge: text(0, 2000),
};
export const salesLeadCreateSchema = z.object({
  ...manualLeadShape,
  consent: z.boolean(),
  source: z.literal("manual"),
  email: manualLeadShape.email.default(""),
  niche: manualLeadShape.niche.default(""),
  team_size: manualLeadShape.team_size.default(""),
  budget_range: manualLeadShape.budget_range.default(""),
  timeline: manualLeadShape.timeline.default(""),
  decision_role: manualLeadShape.decision_role.default(""),
  challenge: manualLeadShape.challenge.default(""),
});
export const salesLeadUpdateSchema = z
  .object({
    ...manualLeadShape,
    stage: z.enum([
      "new",
      "qualified",
      "discovery",
      "proposal",
      "negotiation",
      "won",
      "lost",
    ]),
    priority: z.enum(["low", "normal", "high"]),
    setup_value_cents: cents,
    monthly_value_cents: cents,
    next_action: text(0, 500),
    next_contact_at: z.iso.datetime({ offset: true }).nullable(),
    loss_reason: text(0, 1000),
  })
  .partial()
  .refine((lead) => Object.keys(lead).length > 0);

/** Plain reais only; deliberately reject ambiguous grouping and exponent notation. */
export function salesMoneyToCents(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value)) return Number.NaN;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
/** Forms use Brasília time explicitly, independent of the server timezone. */
export function salesDateToIso(raw: string): string | null {
  if (!raw.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return "invalid";
  const localUtc = new Date(`${raw}:00Z`);
  if (
    !Number.isFinite(localUtc.getTime()) ||
    localUtc.toISOString().slice(0, 16) !== raw
  )
    return "invalid";
  return new Date(localUtc.getTime() + 3 * 60 * 60 * 1000).toISOString();
}
export const salesOfferColumns =
  "id,slug,title,summary,niche,active,published,setup_price_cents,monthly_price_cents,created_at,updated_at";
