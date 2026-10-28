import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AdminNavigation } from "@/components/admin/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { requireOperationsAdmin, operationDate } from "@/lib/admin-operations";
import { niches, plans } from "@/lib/catalog";
import {
  adminSpacesFilters,
  adminSpacesHref,
  adminSpacesPagination,
  adminSpaceNamePattern,
  adminSpaceStatuses,
  adminSpaceStatusLabels,
} from "@/lib/admin-spaces";
import "../admin.css";
import "./espacos.css";

export const dynamic = "force-dynamic";
const companyColumns =
  "id,name,niche,status,plan_id,trial_ends_at,paid_until,created_at,is_demo";
const companySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  niche: z.string(),
  status: z.string(),
  plan_id: z.string(),
  trial_ends_at: z.string().nullable(),
  paid_until: z.string().nullable(),
  created_at: z.string(),
  is_demo: z.boolean(),
});

export default async function Spaces({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    plano?: string | string[];
    situacao?: string | string[];
    segmento?: string | string[];
    pagina?: string | string[];
  }>;
}) {
  const { db } = await requireOperationsAdmin();
  const filters = adminSpacesFilters(await searchParams);
  const now = new Date();
  function companiesQuery(head = false) {
    let query = db.from("companies").select(companyColumns, {
      head,
      ...(head ? { count: "exact" as const } : {}),
    });
    if (filters.search)
      query = query.ilike("name", adminSpaceNamePattern(filters.search));
    if (filters.plan !== "all") query = query.eq("plan_id", filters.plan);
    if (filters.niche !== "all") query = query.eq("niche", filters.niche);
    if (filters.status === "trialing")
      query = query
        .eq("status", "trialing")
        .gt("trial_ends_at", now.toISOString());
    else if (filters.status === "trial_expired")
      query = query
        .eq("status", "trialing")
        .lte("trial_ends_at", now.toISOString());
    else if (filters.status !== "all")
      query = query.eq("status", filters.status);
    return query;
  }
  const countResult = await companiesQuery(true);
  const total = countResult.count ?? 0;
  const pagination = adminSpacesPagination(filters.page, total);
  if (!countResult.error && filters.page !== pagination.page)
    redirect(adminSpacesHref(filters, pagination.page));
  const result = countResult.error
    ? { data: null, error: countResult.error }
    : total === 0
      ? { data: [], error: null }
      : await companiesQuery()
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(pagination.from, pagination.to);
  const parsed = z.array(companySchema).safeParse(result.data ?? []);
  const error = result.error || !parsed.success;
  const companies = !error && parsed.success ? parsed.data : [];
  function statusLabel(company: z.infer<typeof companySchema>) {
    if (company.status === "trialing")
      return company.trial_ends_at &&
        new Date(company.trial_ends_at).getTime() > now.getTime()
        ? "Teste em andamento"
        : "Teste encerrado";
    return (
      adminSpaceStatusLabels[
        company.status as keyof typeof adminSpaceStatusLabels
      ] ?? company.status
    );
  }
  return (
    <main className="admin-shell spaces-page">
      <a href="#spaces-content" className="workspace-skip-link">
        Ir para o conteúdo
      </a>
      <AdminNavigation current="spaces" />
      <div className="admin-content" id="spaces-content">
        <PageHeader
          eyebrow="Empresas da plataforma"
          title="Todos os espaços"
          description="Encontre todas as empresas cadastradas, consulte seu diagnóstico e abra os controles administrativos. A lista inclui os espaços de demonstração."
        />
        <form
          className="spaces-filters"
          action="/admin/espacos"
          method="get"
          role="search"
          aria-label="Filtrar empresas"
        >
          <label htmlFor="spaces-name" className="spaces-name-filter">
            Buscar por nome
            <input
              id="spaces-name"
              name="q"
              type="search"
              defaultValue={filters.search}
              maxLength={80}
              placeholder="Nome da empresa"
            />
          </label>
          <label htmlFor="spaces-plan">
            Plano
            <select id="spaces-plan" name="plano" defaultValue={filters.plan}>
              <option value="all">Todos os planos</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="spaces-status">
            Situação
            <select
              id="spaces-status"
              name="situacao"
              defaultValue={filters.status}
            >
              {adminSpaceStatuses.map((status) => (
                <option key={status} value={status}>
                  {adminSpaceStatusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="spaces-niche">
            Segmento
            <select
              id="spaces-niche"
              name="segmento"
              defaultValue={filters.niche}
            >
              <option value="all">Todos os segmentos</option>
              {niches.map((niche) => (
                <option key={niche.slug} value={niche.slug}>
                  {niche.name}
                </option>
              ))}
            </select>
          </label>
          <div className="spaces-filter-actions">
            <button type="submit" className="button">
              <Icon name="search" size={16} /> Buscar empresas
            </button>
            <Link href="/admin/espacos" className="button secondary">
              Limpar filtros
            </Link>
          </div>
        </form>
        {filters.warning ? (
          <p className="notice" role="status">
            {filters.warning}
          </p>
        ) : null}
        <section
          className="spaces-list"
          aria-labelledby="spaces-list-title"
          id="lista-empresas"
        >
          <div className="spaces-list-heading">
            <div>
              <span className="tag">VISÃO ADMINISTRATIVA</span>
              <h2 id="spaces-list-title">Empresas cadastradas</h2>
            </div>
            <span className="spaces-count">
              {error
                ? "Consulta indisponível"
                : `${total.toLocaleString("pt-BR")} empresa${total === 1 ? " encontrada" : "s encontradas"}`}
            </span>
          </div>
          {error ? (
            <p role="alert" className="notice error">
              Não foi possível carregar as empresas. Atualize a página para
              tentar novamente.
            </p>
          ) : companies.length === 0 ? (
            <EmptyState
              icon="building"
              title="Nenhuma empresa encontrada"
              description="Confira o nome e os filtros ou limpe a busca para consultar todos os espaços cadastrados."
            />
          ) : (
            <div className="spaces-table-wrap">
              <table className="spaces-table">
                <caption className="sr-only">
                  Empresas da plataforma com plano, situação e acesso aos
                  controles administrativos
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Empresa</th>
                    <th scope="col">Plano e situação</th>
                    <th scope="col">Prazos registrados</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}>
                      <td data-label="Empresa">
                        <div className="spaces-company">
                          <span className="spaces-avatar" aria-hidden="true">
                            <Icon name="building" size={18} />
                          </span>
                          <div>
                            <strong>{company.name}</strong>
                            <p>
                              {niches.find(
                                (niche) => niche.slug === company.niche,
                              )?.name ?? company.niche}
                            </p>
                            {company.is_demo ? (
                              <span className="spaces-demo">Demonstração</span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td data-label="Plano e situação">
                        <strong>
                          {plans.find((plan) => plan.id === company.plan_id)
                            ?.name ?? company.plan_id}
                        </strong>
                        <span
                          className={`spaces-status spaces-status-${company.status}`}
                        >
                          {statusLabel(company)}
                        </span>
                      </td>
                      <td data-label="Prazos registrados">
                        <dl className="spaces-dates">
                          <div>
                            <dt>Fim do teste</dt>
                            <dd>
                              {company.trial_ends_at
                                ? operationDate(company.trial_ends_at)
                                : "Não iniciado"}
                            </dd>
                          </div>
                          {company.paid_until ? (
                            <div>
                              <dt>Prazo pago</dt>
                              <dd>{operationDate(company.paid_until)}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>Cadastro</dt>
                            <dd>{operationDate(company.created_at)}</dd>
                          </div>
                        </dl>
                      </td>
                      <td data-label="Ações">
                        <div className="spaces-company-actions">
                          <Link
                            className="button secondary"
                            href={`/admin/redes?empresa=${company.id}`}
                          >
                            <Icon name="briefcase" size={15} />
                            Serviços e redes
                          </Link>
                          <Link
                            className="button secondary"
                            href={`/admin/empresas/${company.id}`}
                          >
                            Diagnóstico de acesso{" "}
                            <Icon name="arrow-right" size={15} />
                          </Link>
                          <Link
                            className="spaces-manage-link"
                            href={`/admin?empresa=${company.id}#empresa-${company.id}`}
                          >
                            Gerenciar empresa <Icon name="settings" size={15} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!error && total > 0 ? (
            <nav
              className="spaces-pagination"
              aria-label="Páginas das empresas"
            >
              <p>
                Exibindo {pagination.from + 1}–
                {pagination.from + companies.length} de{" "}
                {total.toLocaleString("pt-BR")} empresas{" "}
                <span>
                  · Página {pagination.page} de {pagination.pages}
                </span>
              </p>
              <div>
                {pagination.page > 1 ? (
                  <Link
                    className="button secondary"
                    href={adminSpacesHref(filters, pagination.page - 1)}
                    rel="prev"
                  >
                    <Icon name="chevron-left" size={15} /> Anterior
                  </Link>
                ) : null}
                {pagination.page < pagination.pages ? (
                  <Link
                    className="button secondary"
                    href={adminSpacesHref(filters, pagination.page + 1)}
                    rel="next"
                  >
                    Próxima <Icon name="chevron-right" size={15} />
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
        <p className="spaces-scope-note">
          <Icon name="shield" size={16} /> Esta é uma consulta administrativa.
          Abrir o diagnóstico ou os controles não cria participação na empresa.
          A situação exibida reflete o cadastro; o diagnóstico verifica o acesso
          operacional.
        </p>
      </div>
    </main>
  );
}
