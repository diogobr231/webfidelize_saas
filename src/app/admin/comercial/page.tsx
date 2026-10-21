import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { money } from "@/lib/catalog";
import {
  salesStages,
  type SalesLead,
  type SalesOffer,
  type SalesSummary,
} from "@/lib/sales";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import {
  AdminSalesShell,
  SalesPagination,
} from "@/components/sales/admin-shell";
import {
  SALES_PAGE_SIZE,
  salesPageNumber,
  salesPageHref,
  salesStageFilter,
  salesDate,
  salesLabel,
  salesPriorities,
} from "@/components/sales/admin-presenters";
import { requireSalesAdmin } from "./admin-access";

export const dynamic = "force-dynamic";
type LeadCard = Pick<
  SalesLead,
  | "id"
  | "offer_id"
  | "company_name"
  | "contact_name"
  | "stage"
  | "priority"
  | "setup_value_cents"
  | "monthly_value_cents"
  | "next_action"
  | "next_contact_at"
  | "updated_at"
>;

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    produto?: string;
    etapa?: string;
    pagina?: string;
    q?: string;
  }>;
}) {
  const { db } = await requireSalesAdmin();
  const query = await searchParams;
  const offerId = z.uuid().safeParse(query.produto).success
    ? query.produto!
    : null;
  const stage = salesStageFilter(query.etapa);
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const page = salesPageNumber(query.pagina);
  const pageHref = (value: number) =>
    salesPageHref("/admin/comercial", {
      produto: offerId,
      etapa: stage,
      q: search,
      pagina: value,
    });
  let records = db
    .from("sales_leads")
    .select(
      "id,offer_id,company_name,contact_name,stage,priority,setup_value_cents,monthly_value_cents,next_action,next_contact_at,updated_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .order("id");
  if (offerId) records = records.eq("offer_id", offerId);
  if (stage) records = records.eq("stage", stage);
  if (search)
    records = records.ilike(
      "company_name",
      "%" + search.replace(/[\\%_]/g, "\\$&") + "%",
    );
  const [leadsResult, offersResult, summaryResult, selectedResult] =
    await Promise.all([
      records.range((page - 1) * SALES_PAGE_SIZE, page * SALES_PAGE_SIZE - 1),
      db
        .from("sales_offers")
        .select("id,title,active,published")
        .order("title")
        .order("id")
        .limit(200),
      db.rpc("admin_sales_summary", { p_offer_id: offerId }),
      offerId
        ? db
            .from("sales_offers")
            .select("id,title,active,published")
            .eq("id", offerId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  const count = leadsResult.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / SALES_PAGE_SIZE));
  if (!leadsResult.error && page > pages) redirect(pageHref(pages));
  const leads = (leadsResult.data ?? []) as LeadCard[];
  const offers = (offersResult.data ?? []) as Pick<
    SalesOffer,
    "id" | "title" | "active" | "published"
  >[];
  const selected = selectedResult.data as (typeof offers)[number] | null;
  if (selected && !offers.some((offer) => offer.id === selected.id))
    offers.push(selected);
  const offerNames = new Map(offers.map((offer) => [offer.id, offer.title]));
  const summary =
    !summaryResult.error && summaryResult.data
      ? (summaryResult.data as SalesSummary)
      : null;
  const visibleStages = stage
    ? salesStages.filter((item) => item.value === stage)
    : salesStages;
  const today = Date.now();
  return (
    <AdminSalesShell>
      <PageHeader
        eyebrow="Central comercial interna"
        title="Da primeira conversa à proposta."
        description="Acompanhe as oportunidades da Web Fidelize, registre o próximo passo e mantenha o histórico de cada negociação."
        action={
          <Link className="button" href="/admin/comercial/novo">
            <Icon name="plus" size={17} /> Novo contato
          </Link>
        }
      />
      <form
        className="sales-filters panel"
        action="/admin/comercial"
        method="get"
      >
        <div>
          <label htmlFor="sales-search">Buscar empresa</label>
          <input
            id="sales-search"
            name="q"
            defaultValue={search}
            maxLength={80}
            placeholder="Nome da empresa"
          />
        </div>
        <div>
          <label htmlFor="sales-offer">Oferta</label>
          <select id="sales-offer" name="produto" defaultValue={offerId ?? ""}>
            <option value="">Todas as ofertas</option>
            {offers.map((offer) => (
              <option key={offer.id} value={offer.id}>
                {offer.title}
                {!offer.active ? " · arquivada" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sales-stage">Etapa da lista</label>
          <select id="sales-stage" name="etapa" defaultValue={stage ?? ""}>
            <option value="">Todas as etapas</option>
            {salesStages.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <button className="secondary" type="submit">
          Aplicar filtros
        </button>
        {(offerId || stage || search) && (
          <Link href="/admin/comercial" className="sales-inline-link">
            Limpar filtros
          </Link>
        )}
      </form>
      {offersResult.error || selectedResult.error ? (
        <p className="notice error" role="alert">
          Não foi possível carregar as ofertas para o filtro. Tente novamente.
        </p>
      ) : (
        offers.length >= 200 && (
          <p className="sales-hint">
            O seletor mostra as primeiras 200 ofertas por nome, além da oferta
            selecionada.
          </p>
        )
      )}
      <section
        aria-labelledby="sales-overview-title"
        className="sales-overview"
      >
        <div className="sales-section-heading">
          <div>
            <h2 id="sales-overview-title">Visão comercial</h2>
            <p>
              Todas as etapas ·{" "}
              {selected?.title ||
                (offerId ? "Oferta selecionada" : "Todas as ofertas")}
              . Busca e etapa filtram somente a lista.
            </p>
          </div>
        </div>
        {summary ? (
          <>
            <dl className="sales-metrics">
              <div>
                <dt>Total de contatos</dt>
                <dd>{summary.total.toLocaleString("pt-BR")}</dd>
                <p>Registros recebidos ou cadastrados</p>
              </div>
              <div>
                <dt>Negociações em aberto</dt>
                <dd>{summary.open.toLocaleString("pt-BR")}</dd>
                <p>Do novo contato à negociação</p>
              </div>
              <div>
                <dt>Fechados comercialmente</dt>
                <dd>{summary.won.toLocaleString("pt-BR")}</dd>
                <p>Etapa registrada manualmente</p>
              </div>
              <div className={summary.overdue ? "sales-metric-attention" : ""}>
                <dt>Retornos atrasados</dt>
                <dd>{summary.overdue.toLocaleString("pt-BR")}</dd>
                <p>Em aberto, com data de contato vencida</p>
              </div>
            </dl>
            <div className="sales-values panel">
              <div>
                <h3>Potencial em aberto</h3>
                <p>Soma dos valores preenchidos nas negociações abertas.</p>
              </div>
              <dl>
                <div>
                  <dt>Implantação / projeto</dt>
                  <dd>{money(summary.setup_pipeline_cents)}</dd>
                </div>
                <div>
                  <dt>Mensalidade proposta</dt>
                  <dd>
                    {money(summary.monthly_pipeline_cents)}
                    <small>/mês</small>
                  </dd>
                </div>
              </dl>
            </div>
          </>
        ) : (
          <p className="notice error" role="alert">
            Não foi possível consultar os indicadores. Nenhum valor estimado foi
            apresentado.
          </p>
        )}
        <p className="sales-business-note">
          <Icon name="shield" size={17} /> Estes registros representam
          negociações. Marcar como fechado não confirma recebimento, não cobra e
          não ativa assinatura.
        </p>
      </section>
      <section
        className="sales-pipeline"
        aria-labelledby="sales-pipeline-title"
      >
        <div className="sales-section-heading">
          <div>
            <h2 id="sales-pipeline-title">Funil de oportunidades</h2>
            <p>
              {leadsResult.error
                ? "Lista temporariamente indisponível."
                : `${count.toLocaleString("pt-BR")} contatos no filtro · ${leads.length} nesta página · ordenados pela atualização mais recente.`}
            </p>
          </div>
          <Link href="/admin/comercial/ofertas" className="button secondary">
            Gerenciar ofertas <Icon name="arrow-right" size={15} />
          </Link>
        </div>
        {leadsResult.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar os contatos. Atualize a página para tentar
            novamente.
          </p>
        ) : !leads.length ? (
          <EmptyState
            icon="users"
            title={
              offerId || stage
                ? "Nenhum contato neste filtro"
                : "Seu próximo negócio começa com uma conversa"
            }
            description="Cadastre um contato recebido pelo WhatsApp ou acompanhe as solicitações enviadas pelo site. Nenhum dado de demonstração aparece neste painel."
          >
            <Link className="button" href="/admin/comercial/novo">
              Cadastrar contato
            </Link>
          </EmptyState>
        ) : (
          <>
            <p className="sales-hint">
              Abra um cartão para qualificar, alterar a etapa ou registrar o
              próximo contato. As colunas mostram os contatos desta página.
            </p>
            <div
              className="sales-board-scroll"
              role="region"
              aria-label="Etapas do funil comercial"
              tabIndex={0}
            >
              <div
                className={`sales-board ${stage ? "sales-board-filtered" : ""}`}
              >
                {visibleStages.map((item) => {
                  const items = leads.filter(
                    (lead) => lead.stage === item.value,
                  );
                  return (
                    <section
                      className={`sales-column sales-stage-${item.value}`}
                      key={item.value}
                      aria-labelledby={`stage-${item.value}`}
                    >
                      <header>
                        <h3 id={`stage-${item.value}`}>
                          {item.value === "won"
                            ? "Fechados comercialmente"
                            : item.label}
                        </h3>
                        <span
                          aria-label={`${items.length} contatos nesta página`}
                        >
                          {items.length}
                        </span>
                      </header>
                      <ol>
                        {items.map((lead) => {
                          const overdue =
                            lead.next_contact_at &&
                            Date.parse(lead.next_contact_at) < today &&
                            !["won", "lost"].includes(lead.stage);
                          return (
                            <li key={lead.id}>
                              <Link
                                className="sales-lead-card"
                                href={`/admin/comercial/${lead.id}`}
                              >
                                <div className="sales-card-top">
                                  <span>
                                    {offerNames.get(lead.offer_id) ||
                                      "Oferta vinculada"}
                                  </span>
                                  <span
                                    className={`sales-priority sales-priority-${lead.priority}`}
                                  >
                                    {salesLabel(salesPriorities, lead.priority)}
                                  </span>
                                </div>
                                <strong>{lead.company_name}</strong>
                                <p>{lead.contact_name}</p>
                                <div className="sales-card-values">
                                  <span>
                                    Projeto:{" "}
                                    {lead.setup_value_cents === null
                                      ? "Não definido"
                                      : money(lead.setup_value_cents)}
                                  </span>
                                  <span>
                                    Mensal:{" "}
                                    {lead.monthly_value_cents === null
                                      ? "Não definido"
                                      : money(lead.monthly_value_cents)}
                                  </span>
                                </div>
                                {lead.next_action ? (
                                  <p className="sales-card-next">
                                    <Icon name="arrow-right" size={14} />{" "}
                                    {lead.next_action}
                                  </p>
                                ) : (
                                  <p className="sales-card-next">
                                    Próximo passo ainda não definido
                                  </p>
                                )}
                                <span
                                  className={`sales-card-date ${overdue ? "is-overdue" : ""}`}
                                >
                                  <Icon name="clock" size={14} />{" "}
                                  {lead.next_contact_at
                                    ? `${overdue ? "Retorno atrasado · " : "Retorno · "}${salesDate(lead.next_contact_at)}`
                                    : "Sem data de retorno"}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ol>
                      {!items.length && (
                        <p className="sales-column-empty">
                          Nenhum contato nesta etapa na página atual.
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
            <SalesPagination
              page={page}
              count={count}
              pageSize={SALES_PAGE_SIZE}
              href={pageHref}
            />
          </>
        )}
      </section>
    </AdminSalesShell>
  );
}
