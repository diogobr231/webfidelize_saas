"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  operationRuleIds,
  requireOperationsAdmin,
  type OperationActionState,
} from "@/lib/admin-operations";

const version = z.iso.datetime({ offset: true });
function failure(message: string): OperationActionState {
  if (/version|conflict|stale/i.test(message))
    return {
      error:
        "Este registro mudou em outra aba ou execução. Atualize a página antes de tentar novamente.",
    };
  if (/busy/i.test(message))
    return {
      error:
        "Uma verificação já está em andamento. Aguarde alguns instantes e atualize a página.",
    };
  return {
    error:
      "Não foi possível aplicar a alteração. Confira os campos e tente novamente.",
  };
}
function refresh() {
  revalidatePath("/admin");
  revalidatePath("/admin/automacoes");
}
function successRedirect(
  form: FormData,
  notice: "regra" | "concluida" | "reaberta" | "adiada" | "verificada",
): never {
  const status = z
    .enum(["open", "snoozed", "done", "resolved", "all"])
    .safeParse(form.get("return_status"));
  const rule = z.enum(operationRuleIds).safeParse(form.get("return_rule"));
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .safeParse(form.get("return_page"));
  const query = new URLSearchParams({
    aviso: notice,
    status: status.success ? status.data : "open",
    pagina: String(page.success ? page.data : 1),
  });
  if (rule.success) query.set("regra", rule.data);
  redirect(`/admin/automacoes?${query}`);
}

export async function saveAutomation(
  _previous: OperationActionState,
  form: FormData,
): Promise<OperationActionState> {
  const { db } = await requireOperationsAdmin();
  const parsed = z
    .object({
      rule: z.enum(operationRuleIds),
      enabled: z.enum(["true", "false"]),
      threshold: z.coerce.number().int().min(1).max(720),
      updated_at: version,
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Informe um prazo entre 1 e 720 horas e recarregue a página se o registro estiver desatualizado.",
    };
  const { error, data } = await db.rpc("admin_save_automation", {
    p_rule: parsed.data.rule,
    p_enabled: parsed.data.enabled === "true",
    p_threshold_hours: parsed.data.threshold,
    p_expected_updated_at: parsed.data.updated_at,
  });
  if (error || !data) return failure(error?.message ?? "");
  refresh();
  successRedirect(form, "regra");
}
export async function manageOperationTask(
  _previous: OperationActionState,
  form: FormData,
): Promise<OperationActionState> {
  const { db } = await requireOperationsAdmin();
  const parsed = z
    .object({
      id: z.uuid(),
      action: z.enum(["done", "reopen", "snooze24h"]),
      updated_at: version,
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Ação inválida. Atualize a página e tente novamente." };
  const { error, data } = await db.rpc("admin_manage_task", {
    p_id: parsed.data.id,
    p_action: parsed.data.action,
    p_expected_updated_at: parsed.data.updated_at,
  });
  if (error || !data) return failure(error?.message ?? "");
  refresh();
  successRedirect(
    form,
    parsed.data.action === "done"
      ? "concluida"
      : parsed.data.action === "reopen"
        ? "reaberta"
        : "adiada",
  );
}
export async function runOperations(
  _previous: OperationActionState,
  form: FormData,
): Promise<OperationActionState> {
  const { db } = await requireOperationsAdmin();
  const { error, data } = await db.rpc("admin_run_operations");
  if (data) refresh();
  if (error || !data || data.status !== "succeeded")
    return failure(error?.message ?? "");
  successRedirect(form, "verificada");
}
