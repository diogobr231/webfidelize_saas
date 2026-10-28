import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AdminNavigation } from "@/components/admin/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CompanyLimitForm } from "./form";
import { setCompanyWhatsAppLimit } from "./actions";
import {
  adminSpacesFilters,
  adminSpacesPagination,
  adminSpaceNamePattern,
} from "@/lib/admin-spaces";
import "../admin.css";
import "../../painel/[companyId]/lembretes/reminders.css";
import "./quotas.css";

export const dynamic = "force-dynamic";
export default async function WhatsAppAdmin({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; pagina?: string | string[] }>;
}) {
  const { db } = await requireUser();
  const admin = await db.rpc("is_super_admin");
  if (admin.error || !admin.data) notFound();
  const filters = adminSpacesFilters(await searchParams);
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (filters.search) query.set("q", filters.search);
    if (page > 1) query.set("pagina", String(page));
    return `/admin/whatsapp${query.size ? `?${query}` : ""}#cotas-empresas`;
  };
  let countQuery = db
    .from("companies")
    .select("id", { count: "exact", head: true });
  if (filters.search)
    countQuery = countQuery.ilike(
      "name",
      adminSpaceNamePattern(filters.search),
    );
  const countResult = await countQuery;
  const total = countResult.count ?? 0;
  const pagination = adminSpacesPagination(filters.page, total);
  if (!countResult.error && filters.page !== pagination.page)
    redirect(pageHref(pagination.page));
  let companiesQuery = db
    .from("companies")
    .select("id,name")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(pagination.from, pagination.to);
  if (filters.search)
    companiesQuery = companiesQuery.ilike(
      "name",
      adminSpaceNamePattern(filters.search),
    );
  const companies = countResult.error
    ? { data: null, error: countResult.error }
    : total === 0
      ? { data: [], error: null }
      : await companiesQuery;
  const settings = companies.data?.length
    ? await db
        .from("whatsapp_settings")
        .select("company_id,enabled,monthly_limit,platform_limit")
        .in(
          "company_id",
          companies.data.map((company) => company.id),
        )
    : { data: [], error: null };
  const byCompany = new Map(
    (settings.data ?? []).map((item) => [item.company_id, item]),
  );
  return (
    <main className="admin-shell reminder-page">
      <AdminNavigation current="whatsapp" />
      <div className="admin-content">
        <PageHeader
          eyebrow="Controle da plataforma"
          title="WhatsApp por empresa"
          description="Defina um teto mensal de consumo para cada empresa. Somente o SUPER_ADMIN pode liberar ou ampliar esta cota."
        />
        <p className="notice">
          A cota começa em zero. Liberar mensagens não ativa pagamentos nem
          confirma a configuração da Meta. O limite efetivo é o menor entre a
          cota abaixo e o limite escolhido pela empresa.
        </p>
        <form
          action="/admin/whatsapp"
          method="get"
          role="search"
          aria-label="Buscar empresa para consultar cotas"
          className="quota-search"
        >
          <label htmlFor="quota-company-name">
            Buscar empresa por nome
            <input
              id="quota-company-name"
              type="search"
              name="q"
              defaultValue={filters.search}
              maxLength={80}
              placeholder="Nome da empresa"
            />
          </label>
          <button className="button" type="submit">
            Buscar empresas
          </button>
          <Link className="button secondary" href="/admin/whatsapp">
            Limpar busca
          </Link>
        </form>
        {filters.warning ? (
          <p className="notice" role="status">
            {filters.warning}
          </p>
        ) : null}
        <section className="panel" id="cotas-empresas">
          <h2>Cotas mensais</h2>
          <p className="reminder-help">
            Consulte todas as empresas em páginas de 25 registros. O mês segue o
            fuso de São Paulo. Tentativas reservadas para envio, inclusive
            resultados incertos e falhas, consomem a cota. Reduzir o limite não
            apaga o consumo existente.
          </p>
          {companies.error || settings.error ? (
            <p className="notice error" role="alert">
              Não foi possível carregar empresas e cotas. Atualize a página
              antes de editar.
            </p>
          ) : companies.data?.length ? (
            <div className="reminder-admin-list">
              {companies.data.map((company) => {
                const item = byCompany.get(company.id);
                return (
                  <article key={company.id} className="reminder-admin-item">
                    <div>
                      <strong>{company.name}</strong>
                      <p>
                        {item?.enabled
                          ? "Lembretes habilitados pela empresa"
                          : "Lembretes desabilitados pela empresa"}
                      </p>
                      <p>
                        Limite escolhido pela empresa:{" "}
                        {Number(item?.monthly_limit ?? 100).toLocaleString(
                          "pt-BR",
                        )}
                        . Efetivo:{" "}
                        {Math.min(
                          item?.monthly_limit ?? 100,
                          item?.platform_limit ?? 0,
                        ).toLocaleString("pt-BR")}
                        .
                      </p>
                    </div>
                    <CompanyLimitForm
                      limit={item?.platform_limit ?? 0}
                      action={setCompanyWhatsAppLimit.bind(null, company.id)}
                    />
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon="building"
              title={
                filters.search
                  ? "Nenhuma empresa encontrada"
                  : "Nenhuma empresa cadastrada"
              }
              description={
                filters.search
                  ? "Confira o nome ou limpe a busca para consultar todas as empresas."
                  : "As cotas dos novos espaços aparecerão aqui após o cadastro."
              }
            />
          )}
          {!companies.error && !settings.error && total > 0 ? (
            <nav
              className="quota-pagination"
              aria-label="Páginas das cotas por empresa"
            >
              <p>
                Exibindo {pagination.from + 1}–
                {pagination.from + (companies.data?.length ?? 0)} de{" "}
                {total.toLocaleString("pt-BR")} empresas{" "}
                <span>
                  · Página {pagination.page} de {pagination.pages}
                </span>
              </p>
              <div>
                {pagination.page > 1 ? (
                  <Link
                    className="button secondary"
                    href={pageHref(pagination.page - 1)}
                    rel="prev"
                  >
                    Anterior
                  </Link>
                ) : null}
                {pagination.page < pagination.pages ? (
                  <Link
                    className="button secondary"
                    href={pageHref(pagination.page + 1)}
                    rel="next"
                  >
                    Próxima
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}
