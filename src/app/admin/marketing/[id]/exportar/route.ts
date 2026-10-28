import { z } from "zod";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import {
  buildMarketingLink,
  marketingCampaignRecordSchema,
  marketingChannelLabels,
  marketingGoalLabels,
  marketingStatusLabels,
} from "@/lib/marketing";
import { money } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { db } = await requireOperationsAdmin();
  const id = z.uuid().safeParse((await params).id);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!id.success)
    return new Response("Campanha não encontrada", { status: 404, headers });
  const result = await db
    .from("platform_marketing_campaigns")
    .select(
      "id,request_id,name,channel,goal,niche,audience,brief,budget_cents,headline,body,cta,status,version,created_at,updated_at",
    )
    .eq("id", id.data)
    .single();
  const parsed = marketingCampaignRecordSchema.safeParse(result.data);
  if (result.error || !parsed.success)
    return new Response("Exportação indisponível", { status: 404, headers });
  const c = parsed.data;
  let link: string;
  try {
    link = buildMarketingLink(c, process.env.APP_URL ?? "");
  } catch {
    return new Response("Origem pública precisa ser configurada", {
      status: 503,
      headers,
    });
  }
  const text = [
    `WEB FIDELIZE — CAMPANHA`,
    c.name,
    `Situação: ${marketingStatusLabels[c.status]} (decisão interna; não comprova publicação)`,
    `Canal: ${marketingChannelLabels[c.channel]}`,
    `Objetivo: ${marketingGoalLabels[c.goal]}`,
    `Público: ${c.audience}`,
    `Orçamento PLANEJADO: ${money(c.budget_cents)} (nenhuma compra realizada)`,
    `Orientação: ${c.brief}`,
    "",
    c.headline,
    "",
    c.body,
    "",
    c.cta,
    link,
    "",
    "Revise os fatos, as condições e a arte antes de publicar. Não há envio ou ativação automática por este arquivo.",
  ].join("\n");
  return new Response(text, {
    headers: {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="webfidelize-campanha-${c.id.slice(0, 8)}.txt"`,
    },
  });
}
