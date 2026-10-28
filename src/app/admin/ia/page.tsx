import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOperationsAdmin, operationDate } from "@/lib/admin-operations";
import { aiServerConfiguration } from "@/lib/admin-ai/server";
import {
  aiSummarySchema,
  aiJobSchema,
  aiRunSchema,
  aiStatuses,
  aiStatusLabels,
  aiSourceTypes,
  aiSourceLabels,
  aiErrorMessage,
  aiSourceHref,
  type AiSourceOption,
} from "@/lib/admin-ai/types";
import { AdminAiShell } from "@/components/admin-ai/shell";
import {
  AiRequestForm,
  AiSettingsForm,
  AiProcessForm,
  AiReviewForm,
  AiRetryForm,
} from "@/components/admin-ai/forms";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import "../admin.css";
import "./ai.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Central IA | Web Fidelize" };
const jobFields =
  "id,source_type,source_id,source_label,attempt,automatic,status,output,reviewed_body,usage_input_tokens,usage_output_tokens,model,error_code,created_at,updated_at,consumed_at,leased_until,applied_note_id,reviewed_at";
const notices: Record<string, string> = {
  fila: "Análise preparada na fila. O texto será gerado quando o processamento estiver habilitado e o provedor disponível.",
  configuracao:
    "Configuração salva. Os limites e a autorização serão verificados antes de cada processamento.",
  processada:
    "Verificação da fila concluída. Consulte abaixo as análises e o histórico de execução.",
  save: "Rascunho salvo para revisão interna.",
  approve:
    "Análise aprovada internamente. Nenhuma mensagem externa foi enviada.",
  discard: "Rascunho descartado. O histórico foi preservado.",
};

export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    status?: string;
    pagina?: string;
    aviso?: string;
    source_type?: string;
    source_id?: string;
  }>;
}) {
  const { db } = await requireOperationsAdmin();
  const query = await searchParams;
  const selectedId = z.uuid().safeParse(query.id);
  const selectedSourceType = z.enum(aiSourceTypes).safeParse(query.source_type);
  const sourceType = selectedSourceType.success
    ? selectedSourceType.data
    : "lead";
  const sourceId = z.uuid().safeParse(query.source_id);
  const parsedStatus = z.enum(aiStatuses).safeParse(query.status);
  const status = parsedStatus.success ? parsedStatus.data : "all";
  const page = Math.min(
    10000,
    Math.max(1, Number.parseInt(query.pagina ?? "1", 10) || 1),
  );
  let jobsQuery = db
    .from("platform_ai_jobs")
    .select(jobFields, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id");
  if (status !== "all") jobsQuery = jobsQuery.eq("status", status);
  const selectedSourceQuery = !sourceId.success
    ? Promise.resolve({ data: null, error: null })
    : sourceType === "lead"
      ? db
          .from("sales_leads")
          .select("id,company_name")
          .eq("id", sourceId.data)
          .not("stage", "in", "(won,lost)")
          .maybeSingle()
      : sourceType === "ticket"
        ? db
            .from("support_tickets")
            .select("id,subject")
            .eq("id", sourceId.data)
            .in("status", ["open", "in_progress"])
            .maybeSingle()
        : db
            .from("platform_tasks")
            .select("id,source_label,title")
            .eq("id", sourceId.data)
            .eq("status", "open")
            .maybeSingle();
  const [
    summaryResult,
    jobsResult,
    selectedResult,
    leadsResult,
    ticketsResult,
    tasksResult,
    sourceResult,
    runsResult,
  ] = await Promise.all([
    db.rpc("admin_ai_summary"),
    jobsQuery.range((page - 1) * 20, page * 20 - 1),
    selectedId.success
      ? db
          .from("platform_ai_jobs")
          .select(jobFields)
          .eq("id", selectedId.data)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from("sales_leads")
      .select("id,company_name")
      .not("stage", "in", "(won,lost)")
      .order("updated_at", { ascending: false })
      .limit(30),
    db
      .from("support_tickets")
      .select("id,subject")
      .in("status", ["open", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(30),
    db
      .from("platform_tasks")
      .select("id,source_label,title")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(30),
    selectedSourceQuery,
    db
      .from("platform_ai_runs")
      .select("id,created_at,trigger,processed,failed,error_code")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(10),
  ]);
  const summaryParsed = !summaryResult.error
    ? aiSummarySchema.safeParse(summaryResult.data)
    : null;
  const summary = summaryParsed?.success ? summaryParsed.data : null;
  const jobs = !jobsResult.error
    ? z.array(aiJobSchema).safeParse(jobsResult.data)
    : null;
  const selectedParsed =
    !selectedResult.error && selectedResult.data
      ? aiJobSchema.safeParse(selectedResult.data)
      : null;
  const selected = selectedParsed?.success ? selectedParsed.data : null;
  const runs = !runsResult.error
    ? z.array(aiRunSchema).safeParse(runsResult.data)
    : null;
  const sources: AiSourceOption[] = [
    ...(leadsResult.data ?? []).map((lead) => ({
      type: "lead" as const,
      id: lead.id,
      label: lead.company_name,
    })),
    ...(ticketsResult.data ?? []).map((ticket) => ({
      type: "ticket" as const,
      id: ticket.id,
      label: ticket.subject,
    })),
    ...(tasksResult.data ?? []).map((task) => ({
      type: "task" as const,
      id: task.id,
      label: `${task.source_label} · ${task.title}`,
    })),
  ];
  const sourceData = sourceResult.data as {
    id: string;
    company_name?: string;
    subject?: string;
    source_label?: string;
    title?: string;
  } | null;
  if (
    sourceData &&
    !sources.some(
      (source) => source.type === sourceType && source.id === sourceData.id,
    )
  )
    sources.push({
      type: sourceType,
      id: sourceData.id,
      label:
        sourceData.company_name ??
        sourceData.subject ??
        `${sourceData.source_label} · ${sourceData.title}`,
    });
  const sourceError =
    leadsResult.error ||
    ticketsResult.error ||
    tasksResult.error ||
    sourceResult.error;
  const count = jobsResult.count;
  const pages = count === null ? 1 : Math.max(1, Math.ceil(count / 20));
  const pageHref = (number: number) =>
    `/admin/ia?${new URLSearchParams({ status, pagina: String(number) })}#analises`;
  if (jobs?.success && page > pages) redirect(pageHref(pages));
  const config = aiServerConfiguration();
  const lastError = aiErrorMessage(summary?.last_error_code);
  const notice =
    query.aviso && Object.hasOwn(notices, query.aviso)
      ? notices[query.aviso]
      : null;
  return (
    <AdminAiShell>
      <PageHeader
        eyebrow="Inteligência para sua operação"
        title="Boas decisões começam com contexto."
        description="Qualifique oportunidades, prepare próximos passos e revise respostas. A IA auxilia; a decisão continua com você."
        action={<AiProcessForm />}
      />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="ai-provider-state">
        <Icon name="shield" size={21} />
        <div>
          <strong>
            {!config.providerConfigured || !config.workerConfigured
              ? "Configuração da integração pendente"
              : summary?.last_error_code === "verification_required"
                ? "Verificação da conta Vercel pendente"
                : "Integração configurada"}
          </strong>
          <p>
            {!config.providerConfigured
              ? "O provedor de IA ainda não está configurado neste ambiente. "
              : "O provedor está configurado no servidor. "}
            {!config.workerConfigured &&
              "O processamento da fila ainda precisa ser configurado. "}
            A configuração não confirma a disponibilidade da geração. As
            análises abaixo mostram o resultado real de cada tentativa.
          </p>
          {lastError && (
            <p className="ai-provider-error" role="alert">
              {lastError}
            </p>
          )}
        </div>
      </div>
      {summary ? (
        <>
          <dl className="ai-metrics">
            <div>
              <dt>Para revisar</dt>
              <dd>{summary.counts.draft}</dd>
              <p>Rascunhos aguardando sua decisão</p>
            </div>
            <div>
              <dt>Na fila</dt>
              <dd>{summary.counts.queued}</dd>
              <p>{summary.counts.processing} em processamento</p>
            </div>
            <div>
              <dt>Tentativas hoje</dt>
              <dd>
                {summary.quota.daily_used}
                <span> / {summary.settings.daily_limit}</span>
              </dd>
              <p>
                {summary.quota.daily_remaining} disponíveis · horário de
                Brasília
              </p>
            </div>
            <div>
              <dt>Tentativas no mês</dt>
              <dd>
                {summary.quota.monthly_used}
                <span> / {summary.settings.monthly_limit}</span>
              </dd>
              <p>{summary.quota.monthly_remaining} disponíveis neste mês</p>
            </div>
          </dl>
          <p className="ai-hint ai-quota-note">
            Os limites contam tentativas reservadas no backend, inclusive quando
            o provedor falha. Eles controlam o volume de uso, não representam
            saldo financeiro ou crédito contratado.
          </p>
        </>
      ) : (
        <p className="notice error" role="alert">
          Não foi possível carregar os indicadores e limites da central.
          Atualize a página para tentar novamente.
        </p>
      )}
      <div className="ai-capabilities">
        <article>
          <span>
            <Icon name="users" />
          </span>
          <h2>Qualificação comercial</h2>
          <p>
            Entenda a necessidade dos contatos já cadastrados e prepare as
            próximas perguntas.
          </p>
        </article>
        <article>
          <span>
            <Icon name="briefcase" />
          </span>
          <h2>Vendas e implantação</h2>
          <p>
            Transforme o contexto da negociação ou tarefa em um próximo passo e
            um rascunho.
          </p>
        </article>
        <article>
          <span>
            <Icon name="help" />
          </span>
          <h2>Apoio ao atendimento</h2>
          <p>
            Organize a investigação e revise uma sugestão de resposta antes de
            publicar na solicitação.
          </p>
        </article>
      </div>
      {selectedId.success && !selected && (
        <p className="notice error" role="alert">
          {selectedResult.error || selectedParsed?.success === false
            ? "Não foi possível carregar a análise selecionada."
            : "A análise selecionada não foi localizada."}
        </p>
      )}
      {selected && (
        <section
          className="panel ai-selected"
          aria-labelledby="ai-selected-title"
          id="revisao"
          data-ai-job-id={selected.id}
        >
          <div className="ai-heading">
            <div>
              <span className={`ai-badge ai-status-${selected.status}`}>
                {aiStatusLabels[selected.status]}
              </span>
              <h2 id="ai-selected-title">{selected.source_label}</h2>
              <p>
                {aiSourceLabels[selected.source_type]} · tentativa{" "}
                {selected.attempt} · {operationDate(selected.created_at)}
              </p>
            </div>
            <Link className="button secondary" href={aiSourceHref(selected)}>
              Abrir origem <Icon name="arrow-up-right" size={16} />
            </Link>
          </div>
          {selected.error_code && (
            <p className="notice error" role="alert">
              {aiErrorMessage(selected.error_code)}
            </p>
          )}
          {selected.status === "queued" && (
            <p className="ai-hint">
              Esta análise está salva na fila. Habilite o processamento e
              utilize o botão acima, ou aguarde a execução agendada quando a
              conexão estiver disponível.
            </p>
          )}
          {selected.status === "processing" && (
            <p className="notice" role="status">
              A análise está em processamento. Atualize a página para consultar
              o resultado.
            </p>
          )}
          {selected.status === "stale" &&
            selected.error_code === "source_changed" && (
              <p className="notice error" role="alert">
                O registro de origem mudou. Este resultado não pode ser aprovado
                com dados antigos. Prepare uma nova análise.
              </p>
            )}
          {selected.output ? (
            <div className="ai-analysis-grid">
              <section>
                <h3>Análise do contexto</h3>
                <p className="ai-prose">{selected.output.summary}</p>
                <h3>Próximo passo sugerido</h3>
                <p className="ai-prose">{selected.output.next_action}</p>
                <span className="ai-badge">
                  Prioridade sugerida:{" "}
                  {
                    { low: "baixa", normal: "normal", high: "alta" }[
                      selected.output.priority
                    ]
                  }
                </span>
                <p className="ai-hint">
                  Sugestão gerada por IA. Confira os fatos e a situação atual
                  antes de utilizá-la.
                </p>
              </section>
              <section>
                <h3>
                  {selected.status === "approved"
                    ? "Texto aprovado internamente"
                    : "Rascunho sugerido"}
                </h3>
                {selected.status === "draft" ? (
                  <AiReviewForm
                    key={`${selected.id}:${selected.updated_at}`}
                    job={selected}
                  />
                ) : (
                  <p className="ai-prose ai-draft-text">
                    {selected.reviewed_body ||
                      selected.output.suggested_reply ||
                      "Nenhum rascunho de mensagem foi sugerido."}
                  </p>
                )}
                {selected.applied_note_id && (
                  <p className="notice">
                    Texto registrado como nota interna no histórico comercial.
                  </p>
                )}
                {selected.reviewed_at && (
                  <p className="ai-hint">
                    Revisado em {operationDate(selected.reviewed_at)}.
                  </p>
                )}
              </section>
            </div>
          ) : ["draft", "approved"].includes(selected.status) ? (
            <p className="notice error" role="alert">
              O conteúdo da análise não está disponível. Nenhum texto estimado
              foi apresentado.
            </p>
          ) : null}
          {(selected.status === "failed" ||
            (selected.status === "stale" &&
              (selected.error_code === "integration_paused" ||
                selected.error_code === "authorization_revoked"))) && (
            <AiRetryForm
              key={`${selected.id}:${selected.updated_at}`}
              job={selected}
            />
          )}
          <details className="ai-technical">
            <summary>Detalhes da tentativa</summary>
            <dl>
              <div>
                <dt>Origem da solicitação</dt>
                <dd>
                  {selected.automatic
                    ? "Fila automática"
                    : "Solicitação manual"}
                </dd>
              </div>
              <div>
                <dt>Modelo utilizado</dt>
                <dd>{selected.model ?? "Nenhuma geração concluída"}</dd>
              </div>
              <div>
                <dt>Tokens de entrada / saída</dt>
                <dd>
                  {selected.usage_input_tokens === null ||
                  selected.usage_output_tokens === null
                    ? "Não informados pelo provedor"
                    : `${selected.usage_input_tokens} / ${selected.usage_output_tokens}`}
                </dd>
              </div>
              <div>
                <dt>Tentativa contabilizada</dt>
                <dd>
                  {selected.consumed_at
                    ? operationDate(selected.consumed_at)
                    : "Ainda não reservada"}
                </dd>
              </div>
            </dl>
          </details>
        </section>
      )}
      <section
        className="ai-section"
        aria-labelledby="ai-jobs-title"
        id="analises"
      >
        <div className="ai-heading">
          <div>
            <h2 id="ai-jobs-title">Análises e revisão</h2>
            <p>
              {jobs?.success && count !== null
                ? `${count} registros neste filtro · ${jobs.data.length} nesta página.`
                : "Consulte os resultados e os próximos itens da fila."}
            </p>
          </div>
          <form className="ai-filter" action="/admin/ia#analises" method="get">
            <label htmlFor="ai-status-filter">
              Situação
              <select id="ai-status-filter" name="status" defaultValue={status}>
                <option value="all">Todas</option>
                {aiStatuses.map((value) => (
                  <option key={value} value={value}>
                    {aiStatusLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" type="submit">
              Filtrar
            </button>
          </form>
        </div>
        {jobs?.success ? (
          jobs.data.length ? (
            <div className="ai-job-list">
              {jobs.data.map((job) => (
                <Link
                  href={`/admin/ia?id=${job.id}#revisao`}
                  key={job.id}
                  className={`ai-job-card ${selected?.id === job.id ? "is-selected" : ""}`}
                  aria-current={selected?.id === job.id ? "page" : undefined}
                >
                  <div>
                    <span className="ai-hint">
                      {aiSourceLabels[job.source_type]}
                    </span>
                    <strong>{job.source_label}</strong>
                    <span className="ai-hint">
                      {operationDate(job.created_at)} · tentativa {job.attempt}
                    </span>
                  </div>
                  <span className={`ai-badge ai-status-${job.status}`}>
                    {aiStatusLabels[job.status]}
                  </span>
                  <Icon name="chevron-right" size={19} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="sparkles"
              title="Nenhuma análise neste filtro"
              description="Selecione um registro existente para preparar a primeira análise. Os resultados só aparecem após uma geração real."
            />
          )
        ) : (
          <p role="alert" className="notice error">
            Não foi possível carregar as análises.
          </p>
        )}
        {jobs?.success && pages > 1 && (
          <nav className="ai-pagination" aria-label="Páginas de análises">
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
      <div className="ai-workspace-grid">
        <section
          className="panel ai-section"
          id="solicitar"
          aria-labelledby="ai-request-title"
        >
          <div className="ai-heading">
            <div>
              <h2 id="ai-request-title">Preparar uma análise</h2>
              <p>
                Até 30 registros recentes por tipo, além do selecionado. O
                processamento consulta o contexto autorizado no servidor.
              </p>
            </div>
          </div>
          {sourceError ? (
            <p className="notice error" role="alert">
              Não foi possível carregar os registros de origem.
            </p>
          ) : (
            <>
              {sourceId.success && !sourceData && (
                <p className="notice error" role="alert">
                  O registro selecionado não está mais disponível para análise.
                  Ele pode ter sido concluído ou removido.
                </p>
              )}
              <AiRequestForm
                key={`${sourceType}:${sourceId.success ? sourceId.data : ""}`}
                sources={sources}
                selectedType={sourceType}
                selectedId={sourceData?.id ?? ""}
              />
            </>
          )}
          <p className="ai-hint ai-section-note">
            A central trabalha com seus registros existentes. Não busca contatos
            na internet nem envia mensagens por conta própria.
          </p>
        </section>
        <section
          className="panel ai-section"
          id="configuracao"
          aria-labelledby="ai-settings-title"
        >
          <div className="ai-heading">
            <div>
              <h2 id="ai-settings-title">Limites e configuração</h2>
              <p>Controle o processamento e o volume de tentativas.</p>
            </div>
            <span className="ai-badge">
              {!summary
                ? "Indisponível"
                : !summary.settings.authorized_by
                  ? "Autorização pendente"
                  : summary.settings.enabled
                    ? "Processamento habilitado"
                    : "Processamento pausado"}
            </span>
          </div>
          {summary ? (
            <AiSettingsForm
              key={summary.settings.updated_at}
              settings={summary.settings}
            />
          ) : (
            <p className="notice error" role="alert">
              A configuração não pôde ser carregada.
            </p>
          )}
          <p className="ai-hint ai-section-note">
            Execução prevista uma vez ao dia, entre 8h e 9h de Brasília, com até
            3 análises por execução. O botão de processamento também respeita os
            limites. Falhas não são repetidas automaticamente; uma nova
            tentativa precisa ser solicitada.
          </p>
        </section>
      </div>
      <section
        id="historico"
        className="ai-section"
        aria-labelledby="ai-history-title"
      >
        <div className="ai-heading">
          <div>
            <h2 id="ai-history-title">Execuções da central</h2>
            <p>
              Últimas 10 verificações reais. A configuração da rotina não é
              comprovação de execução.
            </p>
          </div>
        </div>
        {runs?.success ? (
          runs.data.length ? (
            <ol className="ai-run-list">
              {runs.data.map((run) => (
                <li className="panel" key={run.id}>
                  <div>
                    <strong>
                      {run.trigger === "scheduled"
                        ? "Execução agendada"
                        : "Execução manual"}
                    </strong>
                    <p>{operationDate(run.created_at)}</p>
                  </div>
                  <span>
                    {run.processed} concluídas · {run.failed} falhas
                  </span>
                  {run.error_code && (
                    <p className="ai-run-error">
                      {aiErrorMessage(run.error_code)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              icon="clock"
              title="Nenhuma execução registrada"
              description="O histórico será preenchido quando a fila for verificada pelo processamento manual ou agendado."
            />
          )
        ) : (
          <p className="notice error" role="alert">
            Não foi possível carregar o histórico de execuções.
          </p>
        )}
      </section>
    </AdminAiShell>
  );
}
