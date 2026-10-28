"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import {
  marketingCampaignSchema,
  marketingCampaignRecordSchema,
  marketingStatuses,
  parseMarketingBudget,
} from "@/lib/marketing";
import { commercialPlans } from "@/lib/commercial";
import {
  generateMarketingCopy,
  marketingAiConfigured,
} from "@/lib/marketing-server";
import { classifyAiFailure } from "@/lib/admin-ai/core";

type State = { error?: string; success?: string };
const base = "/admin/marketing";
const campaignFields =
  "id,request_id,name,channel,goal,niche,audience,brief,budget_cents,headline,body,cta,status,version,created_at,updated_at";
function failure(message?: string): State {
  if (/version/i.test(message ?? ""))
    return {
      error:
        "Esta campanha mudou em outra aba. Atualize a página antes de salvar.",
    };
  if (/generation limit/i.test(message ?? ""))
    return {
      error:
        "O limite de 10 tentativas por dia ou 100 por mês foi atingido. Falhas também contam.",
    };
  if (/generation pending/i.test(message ?? ""))
    return {
      error:
        "Há uma tentativa em andamento ou com resultado ainda desconhecido. Aguarde até 15 minutos antes de tentar novamente.",
    };
  if (/copy required/i.test(message ?? ""))
    return {
      error: "Preencha título, texto e chamada antes de enviar para revisão.",
    };
  return {
    error:
      "Não foi possível salvar. Confira os campos e tente novamente; nenhuma publicação foi realizada.",
  };
}

export async function saveMarketingCampaign(
  _previous: State,
  form: FormData,
): Promise<State> {
  const { db } = await requireOperationsAdmin();
  const budget = parseMarketingBudget(String(form.get("budget") ?? ""));
  const parsed = marketingCampaignSchema.safeParse({
    ...Object.fromEntries(
      [
        "name",
        "channel",
        "goal",
        "niche",
        "audience",
        "brief",
        "headline",
        "body",
        "cta",
      ].map((key) => [key, form.get(key) ?? ""]),
    ),
    budget_cents: budget,
  });
  const request = z.uuid().safeParse(form.get("request_id"));
  const id = form.get("campaign_id")
    ? z.uuid().safeParse(form.get("campaign_id"))
    : null;
  const version = id
    ? z.coerce.number().int().positive().safeParse(form.get("version"))
    : null;
  if (
    !parsed.success ||
    !request.success ||
    (id && (!id.success || !version?.success))
  )
    return {
      error:
        "Confira os campos. O orçamento planejado deve estar entre R$ 0,00 e R$ 100.000,00. Nenhuma compra será feita.",
    };
  const { data, error } = await db.rpc("marketing_save_campaign", {
    p_request_id: request.data,
    p_campaign: id?.success ? id.data : null,
    p_version: version?.success ? version.data : null,
    p_payload: parsed.data,
  });
  const campaign = marketingCampaignRecordSchema.safeParse(data);
  if (error || !campaign.success) return failure(error?.message);
  revalidatePath(base);
  redirect(`${base}?id=${campaign.data.id}&aviso=salvo#editor`);
}

export async function changeMarketingStatus(
  _previous: State,
  form: FormData,
): Promise<State> {
  const { db } = await requireOperationsAdmin();
  const input = z
    .object({
      id: z.uuid(),
      version: z.coerce.number().int().positive(),
      status: z.enum(marketingStatuses),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return failure();
  const { data, error } = await db.rpc("marketing_change_status", {
    p_campaign: input.data.id,
    p_version: input.data.version,
    p_status: input.data.status,
  });
  if (error || !marketingCampaignRecordSchema.safeParse(data).success)
    return failure(error?.message);
  revalidatePath(base);
  redirect(`${base}?id=${input.data.id}&aviso=status#editor`);
}

export async function generateMarketingText(
  _previous: State,
  form: FormData,
): Promise<State> {
  const { db } = await requireOperationsAdmin();
  const input = z
    .object({
      id: z.uuid(),
      version: z.coerce.number().int().positive(),
      confirm_generation: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      error:
        "Confirme que esta geração pode consumir créditos do provedor. O texto salvo será substituído por um novo rascunho.",
    };
  if (!marketingAiConfigured())
    return {
      error:
        "A conexão do AI Gateway precisa ser configurada. Você pode usar o modelo editável sem IA.",
    };
  const [record, plans] = await Promise.all([
    db
      .from("platform_marketing_campaigns")
      .select(campaignFields)
      .eq("id", input.data.id)
      .single(),
    commercialPlans(),
  ]);
  const campaign = marketingCampaignRecordSchema.safeParse(record.data);
  if (record.error || !campaign.success || !plans)
    return {
      error:
        "Não foi possível consultar a campanha e o catálogo atual. Nenhuma geração foi iniciada.",
    };
  if (campaign.data.version !== input.data.version) return failure("version");
  const reserved = await db.rpc("marketing_begin_generation", {
    p_campaign: input.data.id,
    p_version: input.data.version,
  });
  if (reserved.error || !z.uuid().safeParse(reserved.data).success)
    return failure(reserved.error?.message);
  let result: Awaited<ReturnType<typeof generateMarketingCopy>>;
  try {
    result = await generateMarketingCopy(campaign.data, plans);
  } catch (error) {
    const category = classifyAiFailure(error);
    const safeCode =
      category === "verification_required" || category === "quota_exceeded"
        ? category
        : category === "invalid_output"
          ? "invalid_output"
          : "provider_failed";
    const finished = await db.rpc("marketing_finish_generation", {
      p_generation: reserved.data,
      p_error: safeCode,
    });
    revalidatePath(base);
    if (finished.error || finished.data !== "failed")
      return {
        error:
          "O resultado da tentativa não pôde ser registrado. Não repita imediatamente: ela pode ter consumido créditos.",
      };
    if (safeCode === "verification_required")
      return {
        error:
          "O AI Gateway exige verificar a conta na Vercel. Não foi gerado um texto; a tentativa ficou no histórico.",
      };
    if (safeCode === "quota_exceeded")
      return {
        error:
          "O provedor atingiu seu limite ou está sem créditos. Confira a Vercel. O texto anterior foi preservado.",
      };
    return {
      error:
        "O provedor não concluiu uma resposta válida. O texto anterior foi preservado; a tentativa conta no limite e não será repetida automaticamente.",
    };
  }
  const finished = await db.rpc("marketing_finish_generation", {
    p_generation: reserved.data,
    p_output: result.output,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
  });
  revalidatePath(base);
  if (finished.error)
    return {
      error:
        "Não foi possível confirmar o salvamento da geração. Atualize a página antes de tentar novamente.",
    };
  if (finished.data !== "succeeded")
    return {
      error:
        "A campanha mudou ou o prazo da tentativa terminou. A resposta não substituiu seu texto; revise a versão atual.",
    };
  redirect(`${base}?id=${input.data.id}&aviso=ia#editor`);
}
