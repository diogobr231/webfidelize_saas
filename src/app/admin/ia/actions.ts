"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import { processAdminAi } from "@/lib/admin-ai/server";
import { aiErrorLabels } from "@/lib/admin-ai/core";
export type AiActionState = { error?: string };
const version = z.iso.datetime({ offset: true });
function refresh() {
  revalidatePath("/admin/ia");
  revalidatePath("/admin");
  revalidatePath("/admin/comercial/[id]", "page");
}
function failure(message?: string): AiActionState {
  if (/stale|version|source.changed/i.test(message ?? ""))
    return {
      error:
        "O registro mudou. Atualize a página e prepare uma análise com os dados atuais.",
    };
  if (/limit|quota/i.test(message ?? ""))
    return {
      error:
        "Limite de tentativas atingido. Consulte o consumo e os prazos da central.",
    };
  return {
    error:
      "Não foi possível aplicar a ação. Confira os campos e a situação da análise.",
  };
}
export async function requestAnalysis(
  _previous: AiActionState,
  form: FormData,
): Promise<AiActionState> {
  const { db } = await requireOperationsAdmin();
  const input = z
    .object({
      source_type: z.enum(["lead", "ticket", "task"]),
      source_id: z.uuid(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return failure();
  const { data, error } = await db.rpc("admin_ai_request", {
    p_source_type: input.data.source_type,
    p_source_id: input.data.source_id,
  });
  if (error || !z.uuid().safeParse(data).success)
    return failure(error?.message);
  refresh();
  redirect(`/admin/ia?id=${data}&aviso=fila`);
}
export async function saveAiSettings(
  _previous: AiActionState,
  form: FormData,
): Promise<AiActionState> {
  const { db } = await requireOperationsAdmin();
  const input = z
    .object({
      enabled: z.enum(["true", "false"]),
      auto_enqueue: z.enum(["true", "false"]),
      daily_limit: z.coerce.number().int().min(1).max(50),
      monthly_limit: z.coerce.number().int().min(1).max(500),
      updated_at: version,
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success || input.data.daily_limit > input.data.monthly_limit)
    return {
      error:
        "Informe limites válidos: até 50 tentativas por dia e 500 por mês, com limite mensal igual ou maior que o diário.",
    };
  const { data, error } = await db.rpc("admin_ai_settings_save", {
    p_enabled: input.data.enabled === "true",
    p_auto_enqueue: input.data.auto_enqueue === "true",
    p_daily_limit: input.data.daily_limit,
    p_monthly_limit: input.data.monthly_limit,
    p_expected_updated_at: input.data.updated_at,
  });
  if (error || !data) return failure(error?.message);
  refresh();
  redirect("/admin/ia?aviso=configuracao");
}
export async function processAiQueue(
  _previous: AiActionState,
  _form: FormData,
): Promise<AiActionState> {
  await requireOperationsAdmin();
  let errorMessage: string | undefined;
  try {
    const result = await processAdminAi("manual");
    if (result.error) errorMessage = aiErrorLabels[result.error];
  } catch {
    errorMessage =
      "Não foi possível processar a fila. Confira a conexão e a configuração da central; nenhuma aprovação foi realizada.";
  }
  refresh();
  if (errorMessage) return { error: errorMessage };
  redirect("/admin/ia?aviso=processada");
}
export async function reviewAnalysis(
  _previous: AiActionState,
  form: FormData,
): Promise<AiActionState> {
  const { db } = await requireOperationsAdmin();
  const input = z
    .object({
      id: z.uuid(),
      updated_at: version,
      action: z.enum(["save", "approve", "discard"]),
      body: z.string().trim().max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (
    !input.success ||
    (input.data.action !== "discard" && input.data.body.length < 3)
  )
    return { error: "Revise o rascunho: use entre 3 e 2.000 caracteres." };
  const { error, data } = await db.rpc("admin_ai_review", {
    p_job: input.data.id,
    p_action: input.data.action,
    p_body: input.data.body,
    p_expected_updated_at: input.data.updated_at,
  });
  if (error || !data) return failure(error?.message);
  if (data.status === "stale") {
    refresh();
    return failure("source_changed");
  }
  refresh();
  redirect(`/admin/ia?id=${input.data.id}&aviso=${input.data.action}`);
}
export async function retryAnalysis(
  _previous: AiActionState,
  form: FormData,
): Promise<AiActionState> {
  const { db } = await requireOperationsAdmin();
  const input = z
    .object({
      id: z.uuid(),
      updated_at: version,
      confirm_retry: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      error:
        "Confirme a nova tentativa. Ela pode consumir uma nova geração no provedor.",
    };
  const { error, data } = await db.rpc("admin_ai_retry", {
    p_job: input.data.id,
    p_expected_updated_at: input.data.updated_at,
  });
  if (error || !z.uuid().safeParse(data).success)
    return failure(error?.message);
  refresh();
  redirect(`/admin/ia?id=${data}&aviso=fila`);
}
