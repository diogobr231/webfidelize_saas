import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  helpModuleName,
  ticketStatuses,
  type HelpArticle,
  type SupportTicket,
} from "@/lib/help";
import { Brand } from "@/components/ui/brand";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { ArticleEditor, TicketResponse } from "@/components/help/admin-forms";
import { TicketCard } from "@/components/help/ticket-card";
import { saveArticle, respondTicket } from "./actions";
import "../admin.css";
import "@/components/help/help.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gerenciar ajuda | Web Fidelize" };

export default async function AdminHelp({
  searchParams,
}: {
  searchParams: Promise<{
    editar?: string;
    solicitacao?: string;
    status?: string;
    pagina?: string;
    aviso?: string;
  }>;
}) {
  const { db } = await requireUser();
  const { data: admin, error: authError } = await db.rpc("is_super_admin");
  if (authError || !admin) notFound();
  const query = await searchParams;
  const page = Math.min(
    1000,
    Math.max(1, Number.parseInt(query.pagina ?? "1", 10) || 1),
  );
  const status = Object.hasOwn(ticketStatuses, query.status ?? "")
    ? query.status!
    : "todos";
  let ticketQuery = db
    .from("support_tickets")
    .select(
      "id,company_id,requester_id,module,subject,message,status,response,created_at,updated_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });
  if (z.uuid().safeParse(query.solicitacao).success)
    ticketQuery = ticketQuery.eq("id", query.solicitacao!);
  else if (status !== "todos") ticketQuery = ticketQuery.eq("status", status);
  const [articlesResult, ticketsResult] = await Promise.all([
    db
      .from("help_articles")
      .select("id,title,module,kind,body,published,sort_order,updated_at")
      .order("sort_order")
      .order("title")
      .limit(200),
    ticketQuery.range((page - 1) * 10, page * 10 - 1),
  ]);
  const articles = (articlesResult.data ?? []) as HelpArticle[];
  let article = articles.find((item) => item.id === query.editar) ?? null;
  if (query.editar && !article) {
    if (!z.uuid().safeParse(query.editar).success) notFound();
    const { data } = await db
      .from("help_articles")
      .select("id,title,module,kind,body,published,sort_order,updated_at")
      .eq("id", query.editar)
      .single();
    if (!data) notFound();
    article = data as HelpArticle;
  }
  const tickets = (ticketsResult.data ?? []) as SupportTicket[];
  const companyIds = [...new Set(tickets.map((ticket) => ticket.company_id))];
  const companies = companyIds.length
    ? await db.from("companies").select("id,name").in("id", companyIds)
    : { data: [] };
  const companyNames = new Map(
    (companies.data ?? []).map((company) => [company.id, company.name]),
  );
  const pageLink = (number: number) =>
    `/admin/ajuda?${new URLSearchParams({ pagina: String(number), status })}#atendimento`;
  return (
    <main className="admin-shell">
      <nav className="admin-topbar" aria-label="Administração da ajuda">
        <Brand href="/admin" />
        <div className="admin-topbar-actions">
          <Link className="button secondary" href="/admin/ia">
            <Icon name="sparkles" size={16} /> Central IA
          </Link>
          <span className="admin-access">
            <Icon name="shield" size={14} /> SUPER_ADMIN
          </span>
          <Link className="button secondary" href="/admin">
            Voltar à administração
          </Link>
        </div>
      </nav>
      <div className="admin-content help-admin">
        <PageHeader
          eyebrow="Conteúdo e atendimento"
          title="Central de ajuda"
          description="Publique orientações reais e acompanhe as solicitações de cada empresa."
          action={
            <a className="button secondary" href="#atendimento">
              Ver solicitações <Icon name="arrow-right" size={16} />
            </a>
          }
        />
        {query.aviso === "artigo" && (
          <p className="notice" role="status">
            Conteúdo salvo. Somente artigos marcados como publicados ficam
            visíveis para os clientes.
          </p>
        )}
        {query.aviso === "resposta" && (
          <p className="notice" role="status">
            Atendimento atualizado. A resposta está disponível na Central de
            ajuda da empresa.
          </p>
        )}
        <div className="help-admin-content-grid">
          <section
            className="panel help-library"
            aria-labelledby="article-list-title"
          >
            <div className="help-heading">
              <div>
                <h2 id="article-list-title">Biblioteca de orientações</h2>
                <p>Até 200 conteúdos. Retire da publicação para arquivar.</p>
              </div>
              <Link className="button secondary" href="/admin/ajuda#editor">
                <Icon name="plus" size={16} /> Novo
              </Link>
            </div>
            {articlesResult.error ? (
              <p className="notice error" role="alert">
                Não foi possível carregar a biblioteca.
              </p>
            ) : articles.length ? (
              <div className="help-admin-articles">
                {articles.map((item) => (
                  <Link
                    key={item.id}
                    href={`/admin/ajuda?editar=${item.id}#editor`}
                    aria-current={item.id === article?.id ? "page" : undefined}
                  >
                    <div>
                      <span className="help-hint">
                        {helpModuleName(item.module)} ·{" "}
                        {item.kind === "tutorial" ? "Tutorial" : "FAQ"}
                      </span>
                      <strong>{item.title}</strong>
                    </div>
                    <span
                      className={`help-status ${item.published ? "help-status-resolved" : "help-status-open"}`}
                    >
                      {item.published ? "Publicado" : "Rascunho"}
                    </span>
                    <Icon name="chevron-right" size={18} />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Sua biblioteca começa aqui"
                description="Cadastre uma orientação e publique quando estiver pronta."
                icon="help"
              />
            )}
          </section>
          <section
            className="panel help-contact"
            id="editor"
            aria-labelledby="article-editor-title"
          >
            <div className="help-heading">
              <div>
                <h2 id="article-editor-title">
                  {article ? "Editar conteúdo" : "Novo conteúdo"}
                </h2>
                <p>Informações claras, organizadas por assunto.</p>
              </div>
            </div>
            <ArticleEditor
              key={article?.id ?? "new"}
              action={saveArticle.bind(null, article?.id ?? null)}
              article={article}
            />
          </section>
        </div>
        <section
          className="panel help-requests"
          id="atendimento"
          aria-labelledby="support-title"
        >
          <div className="help-heading">
            <div>
              <h2 id="support-title">Atendimento às empresas</h2>
              <p>
                As respostas ficam disponíveis para o solicitante e os gestores
                da empresa.
              </p>
            </div>
          </div>
          <form className="help-admin-filter" action="/admin/ajuda">
            <label htmlFor="support-status">Andamento</label>
            <select name="status" id="support-status" defaultValue={status}>
              <option value="todos">Todos os status</option>
              {Object.entries(ticketStatuses).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
            <button className="secondary" type="submit">
              Filtrar
            </button>
            {query.solicitacao && (
              <Link href="/admin/ajuda#atendimento">
                Ver todas as solicitações
              </Link>
            )}
          </form>
          {ticketsResult.error ? (
            <p className="notice error" role="alert">
              Não foi possível carregar as solicitações.
            </p>
          ) : tickets.length ? (
            <div className="help-admin-tickets">
              {tickets.map((ticket) => (
                <div key={ticket.id}>
                  <div className="help-company-name">
                    <Icon name="building" size={17} />
                    <strong>
                      {companyNames.get(ticket.company_id) ?? "Empresa"}
                    </strong>
                    <small>{ticket.company_id}</small>
                  </div>
                  <TicketCard ticket={ticket}>
                    {ticket.status !== "resolved" && (
                      <Link
                        className="button secondary"
                        href={`/admin/ia?source_type=ticket&source_id=${ticket.id}#solicitar`}
                      >
                        Preparar análise interna com IA
                      </Link>
                    )}
                    <details
                      className="help-response-details"
                      open={query.solicitacao === ticket.id}
                    >
                      <summary>
                        Gerenciar atendimento{" "}
                        <Icon name="chevron-down" size={17} />
                      </summary>
                      <TicketResponse
                        ticket={ticket}
                        action={respondTicket.bind(null, ticket.id)}
                      />
                    </details>
                  </TicketCard>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma solicitação neste filtro"
              description="Novas solicitações das empresas aparecem aqui para acompanhamento."
              icon="mail"
            />
          )}
          {!ticketsResult.error &&
            (page > 1 || (ticketsResult.count ?? 0) > page * 10) && (
              <nav
                className="help-pagination"
                aria-label="Páginas de atendimento"
              >
                {page > 1 && (
                  <Link className="button secondary" href={pageLink(page - 1)}>
                    Anteriores
                  </Link>
                )}
                <span>Página {page}</span>
                {(ticketsResult.count ?? 0) > page * 10 && (
                  <Link className="button secondary" href={pageLink(page + 1)}>
                    Próximas
                  </Link>
                )}
              </nav>
            )}
        </section>
      </div>
    </main>
  );
}
