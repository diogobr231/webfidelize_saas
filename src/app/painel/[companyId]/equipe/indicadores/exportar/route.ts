import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import {
  teamInsightsCsv,
  teamInsightsSchema,
  teamPeriod,
} from "@/lib/team-insights";

export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const { companyId } = await context.params;
  const { db, company, role } = await requireCompany(companyId);
  if (!canManage(role))
    return Response.json(
      {
        error: "Você não tem permissão para exportar os indicadores da equipe.",
      },
      { status: 403, headers: privateHeaders },
    );
  const plan = await db
    .from("plans")
    .select("team_insights,team_export")
    .eq("id", company.plan_id)
    .single();
  if (plan.error)
    return Response.json(
      { error: "Não foi possível consultar o plano." },
      { status: 503, headers: privateHeaders },
    );
  if (!plan.data?.team_insights || !plan.data.team_export)
    return Response.json(
      { error: "A exportação de indicadores requer o plano Empresarial." },
      { status: 403, headers: privateHeaders },
    );
  const search = new URL(request.url).searchParams;
  if (search.getAll("from").length !== 1 || search.getAll("to").length !== 1)
    return Response.json(
      { error: "Informe uma data inicial e uma final." },
      { status: 400, headers: privateHeaders },
    );
  const period = teamPeriod(
    { from: search.get("from"), to: search.get("to") },
    90,
  );
  if (period.error)
    return Response.json(
      { error: period.error },
      { status: 400, headers: privateHeaders },
    );
  // Reauthorize on the database: URL or frontend plan flags never grant access.
  const { data, error } = await db.rpc("company_team_export", {
    p_company: companyId,
    p_from: period.from,
    p_to: period.to,
  });
  if (error)
    return Response.json(
      {
        error:
          "Não foi possível exportar. Atualize suas permissões e tente novamente.",
      },
      { status: 403, headers: privateHeaders },
    );
  const parsed = teamInsightsSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.period.from !== period.from ||
    parsed.data.period.to !== period.to
  )
    return Response.json(
      { error: "O relatório não pôde ser validado." },
      { status: 502, headers: privateHeaders },
    );
  return new Response(teamInsightsCsv(parsed.data), {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="indicadores-equipe-${period.from}-${period.to}.csv"`,
    },
  });
}
