import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { money } from "@/lib/catalog";
import type { CommercialPlan } from "@/lib/commercial";
import { operationDate, type OperationsSummary } from "@/lib/admin-operations";

export function AutomationHealth({ summary }: { summary: OperationsSummary }) {
  const scheduled = summary.last_scheduled_run;
  const recent =
    scheduled?.status === "succeeded" &&
    scheduled.finished_at &&
    Date.now() - Date.parse(scheduled.finished_at) <= 35 * 60_000;
  return (
    <div className={`ops-health ${recent ? "is-healthy" : "needs-attention"}`}>
      <Icon name={recent ? "check" : "clock"} size={19} />
      <div>
        <strong>
          {recent
            ? "Verificação automática recente"
            : "Verificação automática precisa de atenção"}
        </strong>
        <p>
          {scheduled
            ? `Última execução agendada: ${operationDate(scheduled.finished_at ?? scheduled.started_at)} · ${scheduled.status === "succeeded" ? "concluída" : "falhou"}.`
            : "Nenhuma execução agendada registrada ainda."}
          {!recent &&
            " Consulte o histórico e use Verificar agora para atualizar as tarefas."}{" "}
          As verificações são programadas a cada 15 minutos.
        </p>
      </div>
    </div>
  );
}
export function OperationsOverview({
  summary,
  plans,
}: {
  summary: OperationsSummary | null;
  plans: CommercialPlan[] | null;
}) {
  return (
    <section className="ops-overview" aria-labelledby="ops-overview-title">
      <div className="ops-section-heading">
        <div>
          <h2 id="ops-overview-title">O que precisa da sua atenção</h2>
          <p>Operação da Web Fidelize com os registros reais da plataforma.</p>
        </div>
        <Link href="/admin/automacoes" className="button">
          Abrir central de tarefas <Icon name="arrow-right" size={16} />
        </Link>
      </div>
      {summary ? (
        <>
          <dl className="ops-metrics">
            <div>
              <dt>Empresas cadastradas</dt>
              <dd>{summary.companies.total.toLocaleString("pt-BR")}</dd>
              <p>{summary.companies.demo} espaços DEMO fora deste indicador</p>
            </div>
            <div>
              <dt>Negociações abertas</dt>
              <dd>{summary.sales.open.toLocaleString("pt-BR")}</dd>
              <p>{summary.sales.new} novos contatos no funil</p>
            </div>
            <div className={summary.sales.overdue ? "ops-attention" : ""}>
              <dt>Retornos atrasados</dt>
              <dd>{summary.sales.overdue.toLocaleString("pt-BR")}</dd>
              <p>Próximo contato com prazo vencido</p>
            </div>
            <div>
              <dt>Solicitações em aberto</dt>
              <dd>{summary.support.open.toLocaleString("pt-BR")}</dd>
              <p>{summary.support.waiting} fora do prazo configurado</p>
            </div>
            <div className={summary.tasks.open ? "ops-attention" : ""}>
              <dt>Tarefas abertas</dt>
              <dd>{summary.tasks.open.toLocaleString("pt-BR")}</dd>
              <p>Inclui tarefas adiadas</p>
            </div>
            <div>
              <dt>Tarefas concluídas</dt>
              <dd>{summary.tasks.done.toLocaleString("pt-BR")}</dd>
              <p>Conclusões registradas pelo administrador</p>
            </div>
          </dl>
          <div className="ops-status-grid">
            <section className="panel">
              <h3>Acesso das empresas</h3>
              <dl className="ops-inline-stats">
                <div>
                  <dt>Aguardando cartão</dt>
                  <dd>{summary.companies.pending_card}</dd>
                </div>
                <div>
                  <dt>Em teste</dt>
                  <dd>{summary.companies.trialing}</dd>
                </div>
                <div>
                  <dt>Ativas</dt>
                  <dd>{summary.companies.active}</dd>
                </div>
                <div>
                  <dt>Suspensas</dt>
                  <dd>{summary.companies.suspended}</dd>
                </div>
                <div>
                  <dt>Canceladas</dt>
                  <dd>{summary.companies.canceled}</dd>
                </div>
              </dl>
              <p className="ops-hint">
                Situação de acesso registrada no sistema; não representa receita
                recebida.
              </p>
            </section>
            <section className="panel">
              <h3>Acompanhar os testes</h3>
              <dl className="ops-inline-stats">
                <div>
                  <dt>Próximos do fim</dt>
                  <dd>{summary.companies.expiring}</dd>
                </div>
                <div>
                  <dt>Prazo encerrado</dt>
                  <dd>{summary.companies.expired}</dd>
                </div>
              </dl>
              <p className="ops-hint">
                A automação prepara tarefas para os testes próximos do fim. O
                teste dispensa cartão; a assinatura paga depende de confirmação
                do provedor.
              </p>
              <Link
                href="/admin/automacoes?regra=trial_ending"
                className="ops-text-link"
              >
                Ver tarefas dos testes <Icon name="arrow-right" size={15} />
              </Link>
            </section>
          </div>
          <AutomationHealth summary={summary} />
        </>
      ) : (
        <p className="notice error" role="alert">
          Não foi possível carregar os indicadores operacionais. Atualize a
          página para tentar novamente.
        </p>
      )}
      <section className="panel ops-plans" aria-labelledby="ops-plans-title">
        <div>
          <h3 id="ops-plans-title">Catálogo atual de planos</h3>
          <p>Valores mensais e limite de profissionais cadastrados.</p>
        </div>
        {plans ? (
          <ul>
            {plans.map((plan) => (
              <li key={plan.id}>
                <strong>{plan.name}</strong>
                <span>{money(plan.cents)} / mês</span>
                <small>
                  {plan.staff === 1
                    ? "1 profissional"
                    : `Até ${plan.staff} profissionais`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p role="alert" className="notice error">
            Catálogo indisponível. Nenhum preço estimado foi apresentado.
          </p>
        )}
        <Link className="ops-text-link" href="/planos">
          Ver comparação pública <Icon name="arrow-right" size={15} />
        </Link>
      </section>
    </section>
  );
}
