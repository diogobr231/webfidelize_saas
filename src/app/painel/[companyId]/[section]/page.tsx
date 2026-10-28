import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { archiveFilter, businessListQuery } from "@/lib/business-records";
import { money } from "@/lib/catalog";
import {
  recordFilters,
  recordNamePattern,
  recordPagination,
} from "@/lib/record-list";
import { saveRecord, createAppointment } from "../../actions";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PendingButton } from "@/components/pending-button";
import "../../operations.css";
import "./records.css";
const labels = {
  customers: "Clientes",
  services: "Serviços",
  professionals: "Profissionais",
  agenda: "Agenda",
};
const presentation = {
  customers: {
    icon: "users",
    description:
      "Uma base organizada para conhecer seus clientes e cuidar de cada atendimento.",
    singular: "cliente",
    empty: "Seus clientes começam aqui",
    hint: "Cadastre as informações de contato para encontrar cada cliente ao agendar.",
  },
  services: {
    icon: "briefcase",
    description:
      "Organize o que sua empresa oferece, com duração e preço sempre à mão.",
    singular: "serviço",
    empty: "Prepare seu catálogo de serviços",
    hint: "Defina a duração e o valor de cada atendimento. A agenda utiliza essas informações.",
  },
  professionals: {
    icon: "user",
    description:
      "Organize quem atende e prepare a disponibilidade da sua equipe.",
    singular: "profissional",
    empty: "Quem faz o seu negócio acontecer?",
    hint: "Cadastre os profissionais que realizam atendimentos. O acesso ao sistema é gerenciado separadamente.",
  },
  agenda: {
    icon: "calendar",
    description: "Acompanhe os horários e organize os próximos atendimentos.",
    singular: "agendamento",
    empty: "Sua agenda está pronta para começar",
    hint: "Escolha o cliente, o serviço e o profissional para reservar um horário.",
  },
} as const;
export default async function Records({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; section: string }>;
  searchParams: Promise<{
    erro?: string;
    salvo?: string;
    q?: string | string[];
    pagina?: string | string[];
    estado?: string | string[];
  }>;
}) {
  const { companyId, section } = await params;
  if (!Object.hasOwn(labels, section)) notFound();
  const { db, role, company } = await requireCompany(companyId);
  const p = await searchParams;
  const filters = recordFilters(p);
  const table = section === "agenda" ? "appointments" : section;
  const searchable = section !== "agenda";
  const state = archiveFilter(p.estado);
  const search = searchable ? filters.search : "";
  const base = `/painel/${companyId}/${section}`;
  let countQuery = db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (search) countQuery = countQuery.ilike("name", recordNamePattern(search));
  if (searchable && state !== "todos")
    countQuery =
      state === "ativos"
        ? countQuery.is("archived_at", null)
        : countQuery.not("archived_at", "is", null);
  const countResult = await countQuery;
  const pagination = recordPagination(filters.page, countResult.count ?? 0);
  let recordsQuery = db
    .from(table)
    .select("*")
    .eq("company_id", companyId)
    .order(section === "agenda" ? "starts_at" : "name")
    .order("id")
    .range(pagination.from, pagination.to);
  if (search)
    recordsQuery = recordsQuery.ilike("name", recordNamePattern(search));
  if (searchable && state !== "todos")
    recordsQuery =
      state === "ativos"
        ? recordsQuery.is("archived_at", null)
        : recordsQuery.not("archived_at", "is", null);
  const result = countResult.error
    ? { data: null, error: countResult.error }
    : countResult.count === 0
      ? { data: [], error: null }
      : await recordsQuery;
  const { data: rows, error } = result;
  const total = countResult.count ?? 0;
  const pageLink = (page: number) =>
    `${base}?${businessListQuery(state, search, page)}#registros`;
  const managed = canManage(role) && company.access_valid;
  const display = presentation[section as keyof typeof presentation];
  const [customers, services, professionals] =
    section === "agenda" && managed
      ? await Promise.all(
          ["customers", "services", "professionals"].map((t) =>
            db
              .from(t)
              .select("id,name")
              .eq("company_id", companyId)
              .is("archived_at", null),
          ),
        )
      : [];
  return (
    <>
      <PageHeader
        eyebrow="Organização do negócio"
        title={labels[section as keyof typeof labels]}
        description={display.description}
        action={
          managed ? (
            <a className="button" href="#novo-registro">
              <Icon name="plus" size={16} /> Novo {display.singular}
            </a>
          ) : undefined
        }
      />
      {(p.erro || error) && (
        <div role="alert" className="notice error">
          {p.erro === "horario"
            ? "Horário indisponível, fora do expediente ou dados inválidos. Escolha outro horário."
            : "Não foi possível concluir. Confira os campos, seu plano e suas permissões."}
        </div>
      )}
      {p.salvo === "1" && !p.erro && !error && (
        <p className="notice" role="status">
          Cadastro salvo. As informações já estão disponíveis para sua empresa.
        </p>
      )}
      {filters.warning && (
        <p className="notice" role="status">
          {filters.warning}
        </p>
      )}
      <div className={`records-layout${managed ? " has-editor" : ""}`}>
        <section className="panel records-list" id="registros">
          <div className="records-list-heading">
            <div>
              <span className="operations-icon">
                <Icon name={display.icon} size={18} />
              </span>
              <h2>
                {section === "agenda"
                  ? "Atendimentos"
                  : labels[section as keyof typeof labels]}{" "}
                cadastrados
              </h2>
            </div>
            <span className="operations-count">
              {error
                ? "Indisponível"
                : `${total.toLocaleString("pt-BR")} ${search ? "encontrados" : "cadastrados"}`}
            </span>
          </div>
          {searchable && (
            <form
              className="record-search"
              role="search"
              action={base}
              method="get"
            >
              <label htmlFor="record-search">Buscar por nome</label>
              <div>
                <input
                  type="search"
                  id="record-search"
                  name="q"
                  defaultValue={search}
                  maxLength={80}
                  placeholder={`Buscar ${display.singular}…`}
                />
                <button className="button secondary" type="submit">
                  <Icon name="search" size={16} /> Buscar
                </button>
              </div>
              <label htmlFor="record-state">Situação do cadastro</label>
              <select id="record-state" name="estado" defaultValue={state}>
                <option value="ativos">Ativos</option>
                <option value="arquivados">Arquivados</option>
                <option value="todos">Todos</option>
              </select>
              <p className="record-filter-help">
                Escolha a situação e clique em Buscar para aplicar.
              </p>
              {search && (
                <Link href={`${base}?estado=${state}#registros`}>
                  Limpar busca
                </Link>
              )}
            </form>
          )}
          {!rows?.length ? (
            <EmptyState
              icon={display.icon}
              title={
                error
                  ? "Dados indisponíveis"
                  : search
                    ? "Nenhum resultado para esta busca"
                    : state === "arquivados"
                      ? "Nenhum cadastro arquivado"
                      : display.empty
              }
              description={
                error
                  ? "Atualize a página para tentar carregar os dados novamente."
                  : search
                    ? "Confira o nome digitado ou limpe a busca para ver todos os registros autorizados."
                    : state === "arquivados"
                      ? "Os cadastros arquivados aparecerão aqui. O histórico dos atendimentos é preservado."
                      : managed
                        ? display.hint
                        : "Os registros disponíveis para seu perfil aparecerão aqui."
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="records-table" role="table">
                <caption className="sr-only">
                  Registros de{" "}
                  {labels[section as keyof typeof labels].toLocaleLowerCase(
                    "pt-BR",
                  )}{" "}
                  da empresa
                </caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      {section === "agenda" ? "Início" : "Nome"}
                    </th>
                    <th scope="col" role="columnheader">
                      {section === "customers" ? "Telefone" : "Detalhes"}
                    </th>
                    {searchable && (
                      <th scope="col" role="columnheader">
                        Ações
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {rows.map((row) => (
                    <tr key={row.id} role="row">
                      <td
                        role="cell"
                        className="record-name"
                        data-label={section === "agenda" ? "Início" : "Nome"}
                      >
                        {section === "agenda" ? (
                          new Date(row.starts_at).toLocaleString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                          })
                        ) : (
                          <>
                            <Link
                              className="record-detail-name"
                              href={`${base}/${row.id}`}
                            >
                              {row.name}
                            </Link>
                            {row.archived_at ? (
                              <span className="record-archived-label">
                                Arquivado
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td
                        role="cell"
                        data-label={
                          section === "customers" ? "Telefone" : "Detalhes"
                        }
                      >
                        {section === "services" ? (
                          `${row.duration_minutes} min · ${money(row.price_cents)}`
                        ) : section === "customers" ? (
                          row.phone || "Não informado"
                        ) : section === "agenda" ? (
                          `${row.status} · até ${new Date(row.ends_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`
                        ) : (
                          <Link
                            className="record-link"
                            href={`/painel/${companyId}/disponibilidade#turnos`}
                          >
                            Ver horários{" "}
                            <Icon name="arrow-up-right" size={14} />
                          </Link>
                        )}
                      </td>
                      {searchable ? (
                        <td
                          role="cell"
                          data-label="Ações"
                          className="record-actions"
                        >
                          <Link
                            className="record-link"
                            href={`${base}/${row.id}`}
                          >
                            {section === "customers"
                              ? "Ver ficha"
                              : managed && !row.archived_at
                                ? "Editar"
                                : "Ver detalhes"}
                            <Icon name="arrow-right" size={14} />
                          </Link>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!error && total > 0 && (
            <nav
              className="record-pagination"
              aria-label="Páginas dos registros"
            >
              <p>
                Exibindo {pagination.from + 1}–
                {pagination.from + (rows?.length ?? 0)} de{" "}
                {total.toLocaleString("pt-BR")}{" "}
                <span>
                  · Página {pagination.page} de {pagination.pages}
                </span>
              </p>
              <div>
                {pagination.page > 1 && (
                  <Link
                    className="button secondary"
                    href={pageLink(pagination.page - 1)}
                    rel="prev"
                  >
                    <Icon name="chevron-left" size={16} /> Anterior
                  </Link>
                )}
                {pagination.page < pagination.pages &&
                  pagination.page < 10_000 && (
                    <Link
                      className="button secondary"
                      href={pageLink(pagination.page + 1)}
                      rel="next"
                    >
                      Próxima <Icon name="chevron-right" size={16} />
                    </Link>
                  )}
              </div>
            </nav>
          )}
        </section>
        {managed && (
          <section className="panel record-editor" id="novo-registro">
            <span className="operations-icon">
              <Icon name="plus" size={18} />
            </span>
            <h2>Novo {display.singular}</h2>
            <p>{display.hint}</p>
            <form
              className="operations-form"
              action={section === "agenda" ? createAppointment : saveRecord}
            >
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="kind" value={section} />
              {section === "agenda" ? (
                <>
                  <div className="form-grid">
                    {[
                      ["customer_id", "Cliente", customers],
                      ["service_id", "Serviço", services],
                      ["professional_id", "Profissional", professionals],
                    ].map(([key, label, result]) => (
                      <div key={String(key)}>
                        <label htmlFor={String(key)}>{String(label)}</label>
                        <select id={String(key)} name={String(key)} required>
                          <option value="">Selecione</option>
                          {typeof result === "object" &&
                            result?.data?.map(
                              (item: { id: string; name: string }) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ),
                            )}
                        </select>
                      </div>
                    ))}
                  </div>
                  <label htmlFor="starts_at">
                    Data e hora com fuso (ex.: 2026-10-20T10:00:00-03:00)
                  </label>
                  <input
                    id="starts_at"
                    name="starts_at"
                    type="text"
                    placeholder="2026-10-20T10:00:00-03:00"
                    required
                  />
                  <p>
                    Horários exibidos no fuso de São Paulo. O banco confirma a
                    disponibilidade.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="name">Nome</label>
                  <input
                    id="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder={
                      section === "customers"
                        ? "Nome completo do cliente"
                        : section === "services"
                          ? "Nome do atendimento"
                          : "Nome de quem atende"
                    }
                  />
                  {section === "customers" && (
                    <>
                      <label htmlFor="phone">Telefone</label>
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        maxLength={30}
                        placeholder="DDD e número"
                        autoComplete="tel"
                      />
                    </>
                  )}
                  {section === "services" && (
                    <div className="form-grid">
                      <div>
                        <label htmlFor="duration">Duração em minutos</label>
                        <input
                          id="duration"
                          name="duration"
                          type="number"
                          min={5}
                          max={480}
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="price">Preço em reais</label>
                        <input
                          id="price"
                          name="price"
                          type="text"
                          inputMode="decimal"
                          maxLength={9}
                          placeholder="50,00"
                          required
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              <PendingButton>
                Salvar {display.singular} <Icon name="check" size={16} />
              </PendingButton>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
