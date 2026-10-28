import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import {
  bookedTime,
  teamInsightsSchema,
  teamPeriod,
} from "@/lib/team-insights";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import "@/components/team/team.css";

export default async function TeamInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const { companyId } = await params;
  const { db, company } = await requireCompany(companyId, false, true);
  const query = await searchParams;
  const base = `/painel/${companyId}`;
  const plan = await db
    .from("plans")
    .select("name,team_insights,team_export")
    .eq("id", company.plan_id)
    .single();
  const header = (
    <PageHeader
      eyebrow="Gestão da equipe"
      title="Atendimentos em perspectiva"
      description="Veja a distribuição dos agendamentos e acompanhe os atendimentos de cada profissional."
      action={
        <Link className="button secondary" href={`${base}/agenda`}>
          Abrir agenda
        </Link>
      }
    />
  );
  if (plan.error || !plan.data)
    return (
      <>
        {header}
        <p role="alert" className="notice error">
          Não foi possível consultar os recursos do plano. Atualize a página
          para tentar novamente.
        </p>
      </>
    );
  if (!plan.data.team_insights)
    return (
      <>
        {header}
        <section className="panel team-upgrade">
          <span className="tag">A partir do Profissional</span>
          <h2>Entenda como sua equipe está atendendo.</h2>
          <p>
            Compare agendamentos, conclusões, cancelamentos, confirmações de
            presença e tempo reservado por profissional. Filtre até 31 dias por
            consulta no Profissional ou até 90 dias no Empresarial.
          </p>
          <p>
            O Empresarial também inclui a exportação desses indicadores em CSV.
            Sua agenda, cadastros e dashboard atual continuam disponíveis
            conforme suas permissões.
          </p>
          <Link className="button" href={`${base}/assinatura`}>
            Comparar planos e condições
          </Link>
        </section>
      </>
    );
  const maximum = plan.data.team_export ? 90 : 31;
  const period = teamPeriod(query, maximum);
  const response = period.error
    ? null
    : await db.rpc("company_team_insights", {
        p_company: companyId,
        p_from: period.from,
        p_to: period.to,
      });
  const parsed =
    response && !response.error
      ? teamInsightsSchema.safeParse(response.data)
      : null;
  const report =
    parsed?.success &&
    parsed.data.period.from === period.from &&
    parsed.data.period.to === period.to
      ? parsed.data
      : null;
  const filters = new URLSearchParams({
    from: period.from,
    to: period.to,
  }).toString();
  const integer = (value: number) => value.toLocaleString("pt-BR");
  return (
    <>
      {header}
      <p className="team-caption">
        Plano {plan.data.name} · até {maximum} dias por consulta · fuso de São
        Paulo
      </p>
      <form
        className="panel team-filters"
        method="get"
        aria-label="Período dos indicadores"
      >
        <label htmlFor="team-from">
          Data inicial
          <input
            id="team-from"
            name="from"
            type="date"
            min="1900-01-01"
            max="2099-12-31"
            defaultValue={period.from}
            required
          />
        </label>
        <label htmlFor="team-to">
          Data final
          <input
            id="team-to"
            name="to"
            type="date"
            min="1900-01-01"
            max="2099-12-31"
            defaultValue={period.to}
            required
          />
        </label>
        <button type="submit">Aplicar período</button>
      </form>
      {period.error ? (
        <p className="notice error" role="alert">
          {period.error}
        </p>
      ) : !report ? (
        <p className="notice error" role="alert">
          Não foi possível carregar os indicadores. Confira suas permissões e
          atualize a página para tentar novamente.
        </p>
      ) : (
        <>
          <section className="team-metrics" aria-label="Indicadores do período">
            {[
              {
                label: "Agendamentos",
                value: integer(report.totals.total),
                detail: "Todos os status no período",
              },
              {
                label: "Concluídos",
                value: integer(report.totals.completed),
                detail: "Atendimentos marcados como realizados",
              },
              {
                label: "Presenças confirmadas",
                value: integer(report.totals.confirmed),
                detail: "Confirmações registradas, sem cancelados",
              },
              {
                label: "Tempo reservado",
                value: bookedTime(report.totals.booked_minutes),
                detail: "Agendados e concluídos, sem cancelados",
              },
            ].map((metric) => (
              <article className="team-metric" key={metric.label}>
                <h2>{metric.label}</h2>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </section>
          <section className="panel">
            <div className="team-report-heading">
              <div>
                <h2>Por profissional</h2>
                <p>
                  Inclui profissionais arquivados que tiveram agendamentos no
                  período.
                </p>
              </div>
              {plan.data.team_export && (
                <a
                  className="button secondary"
                  href={`${base}/equipe/indicadores/exportar?${filters}`}
                >
                  Baixar indicadores em CSV
                </a>
              )}
            </div>
            {report.totals.total === 0 && (
              <EmptyState
                icon="calendar"
                title="Os primeiros atendimentos vão aparecer aqui"
                description="Não há agendamentos com início neste período. Cadastre os atendimentos ou escolha outras datas para acompanhar a equipe."
              />
            )}
            {report.professionals.length > 0 && (
              <div className="table-wrap">
                <table className="team-results">
                  <caption className="sr-only">
                    Contagens e tempo reservado por profissional no período
                    escolhido
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Profissional</th>
                      <th scope="col">Total</th>
                      <th scope="col">Agendados</th>
                      <th scope="col">Concluídos</th>
                      <th scope="col">Cancelados</th>
                      <th scope="col">Confirmados</th>
                      <th scope="col">Tempo reservado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.professionals.map((professional) => (
                      <tr key={professional.professional_id}>
                        <td data-label="Profissional">
                          <span>
                            {professional.name}
                            {professional.archived && (
                              <small>Arquivado · histórico preservado</small>
                            )}
                          </span>
                        </td>
                        <td data-label="Total">
                          {integer(professional.total)}
                        </td>
                        <td data-label="Agendados">
                          {integer(professional.scheduled)}
                        </td>
                        <td data-label="Concluídos">
                          {integer(professional.completed)}
                        </td>
                        <td data-label="Cancelados">
                          {integer(professional.canceled)}
                        </td>
                        <td data-label="Confirmados">
                          {integer(professional.confirmed)}
                        </td>
                        <td data-label="Tempo reservado">
                          {bookedTime(professional.booked_minutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="team-caption">
              O período considera a data de início do agendamento. Tempo
              reservado soma a duração dos agendados e concluídos; não
              representa horas trabalhadas ou faturamento. Uma presença
              confirmada ainda pode estar agendada.
            </p>
          </section>
          {!plan.data.team_export && (
            <section className="panel team-upgrade">
              <h2>Precisa analisar um período maior?</h2>
              <p>
                No Empresarial, consulte até 90 dias por vez e exporte os
                indicadores da equipe em CSV para trabalhar na sua planilha.
              </p>
              <Link href={`${base}/assinatura`}>Conhecer o Empresarial →</Link>
            </section>
          )}
        </>
      )}
    </>
  );
}
