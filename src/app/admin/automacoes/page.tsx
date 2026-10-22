import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import {
  AutomationRuleForm,
  TaskActions,
  RunOperationsForm,
} from "@/components/admin-operations/forms";
import { AutomationHealth } from "@/components/admin-operations/overview";
import { OperationsShell } from "@/components/admin-operations/shell";
import {
  requireOperationsAdmin,
  operationsSummarySchema,
  operationRuleSchema,
  operationTaskSchema,
  operationRunSchema,
  operationRuleIds,
  operationRuleLabels,
  operationDate,
  operationSourceHref,
} from "@/lib/admin-operations";
import "../admin.css";
import "./operations.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automações e tarefas | Web Fidelize" };
const taskFilters = {
  open: "Pendentes agora",
  snoozed: "Adiadas",
  done: "Concluídas",
  resolved: "Resolvidas automaticamente",
  all: "Todas",
} as const;
const notices = {
  regra: "Regra salva. A próxima verificação usará esta configuração.",
  concluida: "Tarefa concluída. Você pode encontrá-la no filtro Concluídas.",
  reaberta: "Tarefa reaberta. Ela voltou para a lista de pendências.",
  adiada:
    "Tarefa adiada por 24 horas. Você pode encontrá-la no filtro Adiadas.",
  verificada:
    "Verificação concluída. As tarefas e o histórico foram atualizados.",
} as const;

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    regra?: string;
    pagina?: string;
    aviso?: string;
  }>;
}) {
  const { db } = await requireOperationsAdmin();
  const query = await searchParams;
  const page = Math.min(
    10000,
    Math.max(1, Number.parseInt(query.pagina ?? "1", 10) || 1),
  );
  const status = Object.hasOwn(taskFilters, query.status ?? "")
    ? (query.status as keyof typeof taskFilters)
    : "open";
  const parsedRule = z.enum(operationRuleIds).safeParse(query.regra);
  const ruleId = parsedRule.success ? parsedRule.data : "";
  const notice = Object.hasOwn(notices, query.aviso ?? "")
    ? notices[query.aviso as keyof typeof notices]
    : null;
  const returnFilters = { status, rule: ruleId, page };
  const now = new Date().toISOString();
  let tasksQuery = db
    .from("platform_tasks")
    .select(
      "id,rule_id,entity_id,source_label,context_key,title,priority,status,snoozed_until,created_at,updated_at,completed_at",
      { count: "exact" },
    )
    .order("priority")
    .order("created_at", { ascending: false })
    .order("id");
  if (status === "open")
    tasksQuery = tasksQuery
      .eq("status", "open")
      .or(`snoozed_until.is.null,snoozed_until.lte.${now}`);
  else if (status === "snoozed")
    tasksQuery = tasksQuery.eq("status", "open").gt("snoozed_until", now);
  else if (status !== "all") tasksQuery = tasksQuery.eq("status", status);
  if (ruleId) tasksQuery = tasksQuery.eq("rule_id", ruleId);
  const [summaryResult, rulesResult, tasksResult, runsResult] =
    await Promise.all([
      db.rpc("admin_operations_summary"),
      db
        .from("platform_automation_rules")
        .select("id,enabled,threshold_hours,updated_at")
        .order("id"),
      tasksQuery.range((page - 1) * 20, page * 20 - 1),
      db
        .from("platform_automation_runs")
        .select(
          "id,trigger,started_at,finished_at,status,created_count,resolved_count,error_code",
        )
        .order("started_at", { ascending: false })
        .order("id")
        .limit(10),
    ]);
  const summaryParsed = !summaryResult.error
    ? operationsSummarySchema.safeParse(summaryResult.data)
    : null;
  const summary = summaryParsed?.success ? summaryParsed.data : null;
  const rules = !rulesResult.error
    ? z.array(operationRuleSchema).safeParse(rulesResult.data)
    : null;
  const tasks = !tasksResult.error
    ? z.array(operationTaskSchema).safeParse(tasksResult.data)
    : null;
  const runs = !runsResult.error
    ? z.array(operationRunSchema).safeParse(runsResult.data)
    : null;
  const count = tasksResult.count;
  const pages = count === null ? 1 : Math.max(1, Math.ceil(count / 20));
  const pageHref = (value: number) =>
    `/admin/automacoes?${new URLSearchParams({ status, ...(ruleId ? { regra: ruleId } : {}), ...(notice ? { aviso: query.aviso! } : {}), pagina: String(value) })}#tarefas`;
  if (tasks?.success && page > pages) redirect(pageHref(pages));
  return (
    <OperationsShell>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <PageHeader
        eyebrow="Operação da Web Fidelize"
        title="Sua próxima ação, no lugar certo."
        description="Automatize o acompanhamento de vendas, testes e suporte. Cada tarefa aponta para o registro que precisa de atenção."
        action={<RunOperationsForm returnFilters={returnFilters} />}
      />
      {summary ? (
        <AutomationHealth summary={summary} />
      ) : (
        <p role="alert" className="notice error">
          Não foi possível consultar o estado das verificações. Atualize a
          página para tentar novamente.
        </p>
      )}
      <p className="ops-hint">
        Estas rotinas criam e resolvem tarefas internas. Elas não enviam
        mensagens, cobram clientes ou alteram o acesso das empresas. Horários
        exibidos em Brasília.
      </p>
      <section aria-labelledby="ops-rules-title" className="ops-section">
        <div className="ops-section-heading">
          <div>
            <h2 id="ops-rules-title">Regras de acompanhamento</h2>
            <p>
              Prazos entre 1 e 720 horas. Ao pausar, as tarefas existentes
              permanecem disponíveis.
            </p>
          </div>
        </div>
        {rules?.success ? (
          rules.data.length ? (
            <div className="ops-rules">
              {rules.data.map((rule) => (
                <article
                  className="panel ops-rule"
                  data-rule-id={rule.id}
                  key={rule.id}
                >
                  <div className="ops-card-heading">
                    <h3>{operationRuleLabels[rule.id].title}</h3>
                    <span
                      className={`ops-badge ${rule.enabled ? "is-enabled" : ""}`}
                    >
                      {rule.enabled ? "Habilitada" : "Pausada"}
                    </span>
                  </div>
                  <p>{operationRuleLabels[rule.id].description}</p>
                  <AutomationRuleForm
                    key={`${rule.id}:${rule.updated_at}`}
                    rule={rule}
                    thresholdLabel={operationRuleLabels[rule.id].threshold}
                    returnFilters={returnFilters}
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="settings"
              title="Nenhuma regra configurada"
              description="As regras da operação aparecerão aqui quando forem configuradas no sistema."
            />
          )
        ) : (
          <p className="notice error" role="alert">
            Não foi possível carregar as regras. Nenhuma configuração foi
            alterada.
          </p>
        )}
      </section>
      <section
        className="ops-section"
        id="tarefas"
        aria-labelledby="ops-tasks-title"
      >
        <div className="ops-section-heading">
          <div>
            <h2 id="ops-tasks-title">Central de tarefas</h2>
            <p>
              {tasks?.success && count !== null
                ? `${count} tarefas neste filtro · ${tasks.data.length} nesta página.`
                : "Consulte as pendências da operação."}{" "}
              Prioridade alta primeiro.
            </p>
          </div>
        </div>
        <form
          action="/admin/automacoes#tarefas"
          method="get"
          className="panel ops-filters"
        >
          <label htmlFor="ops-status">
            Situação
            <select id="ops-status" name="status" defaultValue={status}>
              {Object.entries(taskFilters).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="ops-rule-filter">
            Origem
            <select id="ops-rule-filter" name="regra" defaultValue={ruleId}>
              <option value="">Todas as regras</option>
              {operationRuleIds.map((id) => (
                <option value={id} key={id}>
                  {operationRuleLabels[id].title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary">
            Aplicar filtros
          </button>
        </form>
        {tasks?.success ? (
          tasks.data.length ? (
            <div className="ops-tasks">
              {tasks.data.map((task) => {
                const snoozed =
                  task.status === "open" &&
                  task.snoozed_until &&
                  Date.parse(task.snoozed_until) > Date.now();
                return (
                  <article
                    className="panel ops-task"
                    data-task-id={task.id}
                    key={task.id}
                  >
                    <div className="ops-card-heading">
                      <span
                        className={`ops-badge ${task.priority === "high" ? "is-high" : ""}`}
                      >
                        {task.priority === "high"
                          ? "Prioridade alta"
                          : "Acompanhamento"}
                      </span>
                      <span className="ops-badge">
                        {task.status === "done"
                          ? "Concluída"
                          : task.status === "resolved"
                            ? "Resolvida automaticamente"
                            : snoozed
                              ? "Adiada"
                              : "Pendente"}
                      </span>
                    </div>
                    <h3>{task.title}</h3>
                    <p className="ops-task-source">{task.source_label}</p>
                    <p className="ops-hint">
                      {operationRuleLabels[task.rule_id].title}
                      <br />
                      Criada em {operationDate(task.created_at)}
                      {snoozed && (
                        <> · Retorna em {operationDate(task.snoozed_until)}</>
                      )}
                    </p>
                    <Link
                      className="ops-text-link"
                      href={operationSourceHref(task)}
                    >
                      Abrir registro de origem{" "}
                      <Icon name="arrow-up-right" size={15} />
                    </Link>
                    <TaskActions
                      key={`${task.id}:${task.updated_at}`}
                      task={task}
                      returnFilters={returnFilters}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="check"
              title="Nenhuma tarefa neste filtro"
              description="As regras habilitadas identificam novas pendências a cada verificação. Você também pode verificar agora."
            />
          )
        ) : (
          <p className="notice error" role="alert">
            Não foi possível carregar as tarefas. Atualize a página para tentar
            novamente.
          </p>
        )}
        {tasks?.success && pages > 1 && (
          <nav className="ops-pagination" aria-label="Páginas de tarefas">
            {page > 1 && (
              <Link className="button secondary" href={pageHref(page - 1)}>
                Anterior
              </Link>
            )}
            <span>
              Página {page} de {pages}
            </span>
            {page < pages && (
              <Link className="button secondary" href={pageHref(page + 1)}>
                Próxima
              </Link>
            )}
          </nav>
        )}
      </section>
      <section className="ops-section" aria-labelledby="ops-runs-title">
        <div className="ops-section-heading">
          <div>
            <h2 id="ops-runs-title">Histórico de verificações</h2>
            <p>As 10 execuções mais recentes, manuais e agendadas.</p>
          </div>
        </div>
        {runs?.success ? (
          runs.data.length ? (
            <ol className="ops-runs">
              {runs.data.map((run) => (
                <li className="panel" key={run.id}>
                  <div>
                    <strong>
                      {run.trigger === "scheduled"
                        ? "Execução agendada"
                        : "Verificação manual"}
                    </strong>
                    <p>{operationDate(run.started_at)}</p>
                  </div>
                  <span
                    className={`ops-badge ${run.status === "succeeded" ? "is-enabled" : "is-high"}`}
                  >
                    {run.status === "succeeded" ? "Concluída" : "Falhou"}
                  </span>
                  <p>
                    {run.status === "succeeded"
                      ? `${run.created_count} tarefas criadas · ${run.resolved_count} resolvidas`
                      : "A verificação não foi concluída. Tente novamente ou consulte o suporte técnico."}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              icon="clock"
              title="A primeira verificação ainda não foi registrada"
              description="Use Verificar agora ou aguarde a primeira execução agendada."
            />
          )
        ) : (
          <p role="alert" className="notice error">
            Não foi possível carregar o histórico.
          </p>
        )}
      </section>
    </OperationsShell>
  );
}
