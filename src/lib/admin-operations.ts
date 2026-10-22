import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

export const operationRuleIds = [
  "lead_followup",
  "lead_idle",
  "trial_ending",
  "support_waiting",
] as const;
export type OperationRuleId = (typeof operationRuleIds)[number];
export const operationRuleLabels: Record<
  OperationRuleId,
  { title: string; description: string; threshold: string }
> = {
  lead_followup: {
    title: "Retornos comerciais atrasados",
    description:
      "Cria uma tarefa quando o próximo contato de uma negociação aberta passa do prazo configurado.",
    threshold: "Horas após o horário de retorno",
  },
  lead_idle: {
    title: "Novos contatos sem retorno agendado",
    description:
      "Lembra você de acompanhar novos contatos que ficaram sem atualização e ainda não têm um próximo retorno agendado.",
    threshold: "Horas sem atualizar o novo contato",
  },
  trial_ending: {
    title: "Testes próximos do fim",
    description:
      "Cria uma tarefa para acompanhar empresas reais cujo período de teste está terminando.",
    threshold: "Horas antes do fim do teste",
  },
  support_waiting: {
    title: "Solicitações aguardando atendimento",
    description:
      "Sinaliza solicitações abertas ou em atendimento sem atualização no prazo configurado.",
    threshold: "Horas sem atualização na solicitação",
  },
};
const timestamp = z.iso.datetime({ offset: true });
const counter = z.number().int().nonnegative();
export const operationRunSchema = z.object({
  id: z.uuid(),
  trigger: z.enum(["manual", "scheduled"]),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  status: z.enum(["succeeded", "failed"]),
  created_count: counter,
  resolved_count: counter,
  error_code: z.string().nullable(),
});
export const operationsSummarySchema = z.object({
  companies: z.object({
    total: counter,
    demo: counter,
    pending_card: counter,
    trialing: counter,
    active: counter,
    expiring: counter,
    expired: counter,
    suspended: counter,
    canceled: counter,
  }),
  sales: z.object({ open: counter, overdue: counter, new: counter }),
  support: z.object({ open: counter, waiting: counter }),
  tasks: z.object({ open: counter, done: counter }),
  last_run: operationRunSchema.nullable(),
  last_scheduled_run: operationRunSchema.nullable().optional(),
});
export const operationRuleSchema = z.object({
  id: z.enum(operationRuleIds),
  enabled: z.boolean(),
  threshold_hours: z.number().int().min(1).max(720),
  updated_at: timestamp,
});
export const operationTaskSchema = z.object({
  id: z.uuid(),
  rule_id: z.enum(operationRuleIds),
  entity_id: z.uuid(),
  source_label: z.string(),
  context_key: z.string(),
  title: z.string(),
  priority: z.enum(["normal", "high"]),
  status: z.enum(["open", "done", "resolved"]),
  snoozed_until: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
  completed_at: timestamp.nullable(),
});
export type OperationsSummary = z.infer<typeof operationsSummarySchema>;
export type OperationRule = z.infer<typeof operationRuleSchema>;
export type OperationTask = z.infer<typeof operationTaskSchema>;
export type OperationRun = z.infer<typeof operationRunSchema>;
export type OperationActionState = { error?: string; success?: string };
export type OperationReturnFilters = {
  status: string;
  rule: string;
  page: number;
};

/** Per-request guard. The database separately enforces SUPER_ADMIN on every RPC and table. */
export const requireOperationsAdmin = cache(
  async function requireOperationsAdmin() {
    const session = await requireUser();
    const { data, error } = await session.db.rpc("is_super_admin");
    if (error || data !== true) notFound();
    return session;
  },
);
export function operationDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return "Ainda não registrada";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}
export function operationSourceHref(
  task: Pick<OperationTask, "rule_id" | "entity_id">,
) {
  if (task.rule_id === "trial_ending")
    return `/admin?empresa=${task.entity_id}#empresa-${task.entity_id}`;
  if (task.rule_id === "support_waiting")
    return `/admin/ajuda?solicitacao=${task.entity_id}`;
  return `/admin/comercial/${task.entity_id}`;
}
