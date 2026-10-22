import { z } from "zod";
import { aiOutputSchema, aiErrorLabels, type AiErrorCode } from "./core";

const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
export const aiSourceTypes = ["lead", "ticket", "task"] as const;
export const aiStatuses = [
  "queued",
  "processing",
  "draft",
  "approved",
  "discarded",
  "failed",
  "stale",
] as const;
export const aiStatusLabels: Record<(typeof aiStatuses)[number], string> = {
  queued: "Na fila",
  processing: "Processando",
  draft: "Para revisar",
  approved: "Aprovada internamente",
  discarded: "Descartada",
  failed: "Falhou",
  stale: "Revisão necessária",
};
export const aiSourceLabels: Record<(typeof aiSourceTypes)[number], string> = {
  lead: "Oportunidade comercial",
  ticket: "Solicitação de suporte",
  task: "Tarefa operacional",
};
export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  auto_enqueue: z.boolean(),
  daily_limit: count.max(50),
  monthly_limit: count.max(500),
  authorized_by: z.uuid().nullable(),
  updated_at: timestamp,
  last_error_code: z.string().nullable(),
  last_worker_at: timestamp.nullable(),
  last_worker_trigger: z.enum(["manual", "scheduled"]).nullable(),
});
export const aiRunSchema = z.object({
  id: z.uuid(),
  created_at: timestamp,
  trigger: z.enum(["manual", "scheduled"]),
  processed: count.max(3),
  failed: count.max(3),
  error_code: z.string().nullable(),
});
export const aiSummarySchema = z.object({
  settings: aiSettingsSchema,
  quota: z.object({
    day: z.string(),
    month: z.string(),
    daily_used: count,
    monthly_used: count,
    daily_remaining: count,
    monthly_remaining: count,
  }),
  counts: z.object({
    queued: count,
    processing: count,
    draft: count,
    approved: count,
    discarded: count,
    failed: count,
    stale: count,
  }),
  last_error_code: z.string().nullable(),
  last_run: aiRunSchema.nullable(),
});
export const aiJobSchema = z.object({
  id: z.uuid(),
  source_type: z.enum(aiSourceTypes),
  source_id: z.uuid(),
  source_label: z.string(),
  attempt: z.number().int().positive(),
  automatic: z.boolean(),
  status: z.enum(aiStatuses),
  output: aiOutputSchema.nullable(),
  reviewed_body: z.string(),
  usage_input_tokens: count.nullable(),
  usage_output_tokens: count.nullable(),
  model: z.string().nullable(),
  error_code: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  consumed_at: timestamp.nullable(),
  leased_until: timestamp.nullable(),
  applied_note_id: z.uuid().nullable(),
  reviewed_at: timestamp.nullable(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiSummary = z.infer<typeof aiSummarySchema>;
export type AiJob = z.infer<typeof aiJobSchema>;
export type AiSourceType = (typeof aiSourceTypes)[number];
export type AiSourceOption = { type: AiSourceType; id: string; label: string };

export function aiErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (Object.hasOwn(aiErrorLabels, code))
    return aiErrorLabels[code as AiErrorCode];
  const other: Record<string, string> = {
    integration_paused:
      "O processamento está pausado. Revise a configuração antes de reativar.",
    daily_limit:
      "O limite diário de tentativas foi atingido. A fila permanece salva.",
    monthly_limit:
      "O limite mensal de tentativas foi atingido. A fila permanece salva.",
    configuration_missing:
      "A configuração do processamento ainda não foi concluída.",
  };
  return (
    other[code] ??
    "O processamento encontrou um erro. Consulte a configuração antes de tentar novamente."
  );
}
export function aiSourceHref(job: Pick<AiJob, "source_type" | "source_id">) {
  if (job.source_type === "lead") return `/admin/comercial/${job.source_id}`;
  if (job.source_type === "ticket")
    return `/admin/ajuda?solicitacao=${job.source_id}#atendimento`;
  return `/admin/automacoes?status=all#tarefas`;
}
