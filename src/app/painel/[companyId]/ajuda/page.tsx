import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import {
  filterArticles,
  helpModuleName,
  helpModules,
  type HelpArticle,
  type SupportTicket,
} from "@/lib/help";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { TicketForm } from "@/components/help/ticket-form";
import { TicketCard } from "@/components/help/ticket-card";
import { openTicket } from "./actions";
import "@/components/help/help.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Central de ajuda | Web Fidelize" };

export default async function HelpPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    q?: string;
    modulo?: string;
    pagina?: string;
    aviso?: string;
  }>;
}) {
  const { companyId } = await params;
  const query = await searchParams;
  const { db, role } = await requireCompany(companyId);
  const module = helpModules.some((item) => item.id === query.modulo)
    ? query.modulo!
    : "todos";
  const search = typeof query.q === "string" ? query.q.slice(0, 120) : "";
  const page = Math.min(
    1000,
    Math.max(1, Number.parseInt(query.pagina ?? "1", 10) || 1),
  );
  const [articlesResult, ticketsResult] = await Promise.all([
    db
      .from("help_articles")
      .select("id,title,module,kind,body,published,sort_order,updated_at")
      .eq("published", true)
      .order("sort_order")
      .order("title")
      .limit(200),
    db
      .from("support_tickets")
      .select(
        "id,company_id,requester_id,module,subject,message,status,response,created_at,updated_at",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range((page - 1) * 10, page * 10 - 1),
  ]);
  const articles = filterArticles(
    (articlesResult.data ?? []) as HelpArticle[],
    search,
    module,
  );
  const base = `/painel/${companyId}/ajuda`;
  const articleLink = (id: string) =>
    `${base}?${new URLSearchParams({ modulo: id, ...(search ? { q: search } : {}) })}#conteudos`;
  const pageLink = (nextPage: number) =>
    `${base}?${new URLSearchParams({ pagina: String(nextPage), ...(module !== "todos" ? { modulo: module } : {}), ...(search ? { q: search } : {}) })}#solicitacoes`;
  const open = openTicket.bind(null, companyId);
  return (
    <div className="help-center">
      <PageHeader
        eyebrow="Você não precisa descobrir tudo sozinho"
        title="Como podemos ajudar?"
        description="Orientações práticas para sua rotina, do primeiro acesso ao próximo atendimento."
        action={
          <a
            className="button secondary"
            href="https://wa.me/5518997695445?text=Ol%C3%A1%2C%20preciso%20de%20ajuda%20com%20a%20Web%20Fidelize."
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="phone" size={17} /> Falar no WhatsApp
          </a>
        }
      />
      <div className="help-shortcuts">
        {canManage(role) && (
          <Link href={`/painel/${companyId}/configuracao`}>
            <Icon name="sparkles" />
            <span>
              <strong>Primeiros passos</strong>
              <small>Retome a configuração da empresa</small>
            </span>
            <Icon name="arrow-right" size={17} />
          </Link>
        )}
        <a href="#nova-solicitacao">
          <Icon name="mail" />
          <span>
            <strong>Abrir solicitação</strong>
            <small>Conte com o suporte da Web Fidelize</small>
          </span>
          <Icon name="arrow-right" size={17} />
        </a>
        <a href="#solicitacoes">
          <Icon name="clock" />
          <span>
            <strong>Acompanhar solicitações</strong>
            <small>Veja o andamento e as respostas</small>
          </span>
          <Icon name="arrow-right" size={17} />
        </a>
      </div>
      <section
        className="panel help-library"
        id="conteudos"
        aria-labelledby="help-content-title"
      >
        <div className="help-heading">
          <div>
            <h2 id="help-content-title">Encontre sua resposta</h2>
            <p>Tutoriais e dúvidas frequentes sobre os recursos disponíveis.</p>
          </div>
        </div>
        <form role="search" className="help-search" action={base}>
          <label htmlFor="help-search" className="help-visually-hidden">
            Buscar na central de ajuda
          </label>
          <div>
            <Icon name="search" size={19} />
            <input
              id="help-search"
              name="q"
              type="search"
              maxLength={120}
              placeholder="Busque por horários, equipe, serviços…"
              defaultValue={search}
            />
          </div>
          {module !== "todos" && (
            <input type="hidden" name="modulo" value={module} />
          )}
          <button type="submit">Buscar</button>
        </form>
        <nav className="help-modules" aria-label="Assuntos da ajuda">
          <Link
            href={articleLink("todos")}
            aria-current={module === "todos" ? "page" : undefined}
          >
            Todos
          </Link>
          {helpModules.map((item) => (
            <Link
              key={item.id}
              href={articleLink(item.id)}
              aria-current={module === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} size={15} />
              {item.name}
            </Link>
          ))}
        </nav>
        {articlesResult.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar os conteúdos. Tente atualizar a página ou
            use o WhatsApp.
          </p>
        ) : articles.length ? (
          <div className="help-articles">
            {articles.map((article) => (
              <details key={article.id} className="help-article">
                <summary>
                  <span>
                    <small>
                      {helpModuleName(article.module)} ·{" "}
                      {article.kind === "tutorial"
                        ? "Passo a passo"
                        : "Pergunta frequente"}
                    </small>
                    <strong>{article.title}</strong>
                  </span>
                  <Icon name="chevron-down" size={18} />
                </summary>
                <div className="help-article-body">
                  <p className="help-prose">{article.body}</p>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="search"
            title="Ainda não encontramos essa resposta"
            description="Tente outro termo ou envie sua dúvida para o suporte."
          >
            <Link className="button secondary" href={base}>
              Limpar filtros
            </Link>
          </EmptyState>
        )}
        <p className="help-hint">
          Os conteúdos cobrem os recursos disponíveis da plataforma. Módulos
          específicos em planejamento não aparecem como funcionalidades prontas.
        </p>
      </section>
      <div className="help-support-grid">
        <section
          className="panel help-contact"
          id="nova-solicitacao"
          aria-labelledby="help-request-title"
        >
          <div className="help-heading">
            <div>
              <h2 id="help-request-title">Vamos resolver juntos</h2>
              <p>Descreva sua dúvida e acompanhe a resposta por aqui.</p>
            </div>
          </div>
          <TicketForm
            action={open}
            requestKey={randomUUID()}
            companyId={companyId}
            module={module === "todos" ? "primeiros-passos" : module}
          />
        </section>
        <section
          className="panel help-requests"
          id="solicitacoes"
          aria-labelledby="help-tickets-title"
        >
          <div className="help-heading">
            <div>
              <h2 id="help-tickets-title">
                {canManage(role)
                  ? "Solicitações da empresa"
                  : "Minhas solicitações"}
              </h2>
              <p>
                {canManage(role)
                  ? "Os gestores acompanham as solicitações da equipe."
                  : "Somente solicitações abertas pela sua conta."}
              </p>
            </div>
          </div>
          {query.aviso === "enviada" && (
            <p className="notice" role="status">
              Solicitação registrada. Acompanhe o andamento nesta lista.
            </p>
          )}
          {ticketsResult.error ? (
            <p className="notice error" role="alert">
              Não conseguimos carregar as solicitações. Atualize a página para
              tentar novamente.
            </p>
          ) : ticketsResult.data?.length ? (
            <div className="help-tickets">
              {(ticketsResult.data as SupportTicket[]).map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="mail"
              title="Tudo tranquilo por aqui"
              description="Quando você enviar uma solicitação, o andamento e a resposta aparecerão neste espaço."
            />
          )}
          {!ticketsResult.error &&
            (page > 1 || (ticketsResult.count ?? 0) > page * 10) && (
              <nav
                className="help-pagination"
                aria-label="Páginas de solicitações"
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
    </div>
  );
}
