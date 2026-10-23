import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage, hasAccess } from "@/lib/permissions";
import {
  addDays,
  agendaRange,
  appointmentTime,
  saoPauloDay,
  validDay,
} from "@/lib/scheduling";
import {
  classPage,
  classPageSize,
  classStatus,
  type ClassChoice,
  type ClassSession,
} from "@/lib/classes";
import { relatedBusinessName } from "@/lib/business-records";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { ClassForm } from "@/components/classes/class-form";
import { saveClass } from "./actions";
import "@/components/classes/classes.css";

export default async function ClassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ day?: string; pagina?: string }>;
}) {
  const { companyId } = await params;
  const { db, role, company } = await requireCompany(companyId);
  const query = await searchParams;
  const day = validDay(query.day) ? query.day : saoPauloDay();
  const last = addDays(day, 6);
  const page = classPage(query.pagina);
  const managed = canManage(role);
  const writable = hasAccess(company.status, company.trial_ends_at);
  const [sessions, services, professionals] = await Promise.all([
    db
      .from("class_sessions")
      .select(
        "id,company_id,service_id,professional_id,title,starts_at,ends_at,capacity,status,is_public,version,services(name),professionals(name)",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .gte("starts_at", agendaRange(day, "day").start)
      .lt("starts_at", agendaRange(last, "day").end)
      .order("starts_at")
      .order("id")
      .range((page - 1) * classPageSize, page * classPageSize - 1),
    managed && writable
      ? db
          .from("services")
          .select("id,name,duration_minutes")
          .eq("company_id", companyId)
          .is("archived_at", null)
          .order("name")
          .limit(500)
      : Promise.resolve(null),
    managed && writable
      ? db
          .from("professionals")
          .select("id,name")
          .eq("company_id", companyId)
          .is("archived_at", null)
          .order("name")
          .limit(100)
      : Promise.resolve(null),
  ]);
  const rows = (sessions.data ?? []) as unknown as (ClassSession & {
    services: unknown;
    professionals: unknown;
  })[];
  const route = `/painel/${companyId}/turmas`;
  const href = (target: number) =>
    `${route}?${new URLSearchParams({ day, pagina: String(target) })}`;
  const dateLabel = (value: string) =>
    new Date(value).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  return (
    <div className="classes-page">
      <PageHeader
        eyebrow="Atendimentos em grupo"
        title={managed ? "Turmas e atividades" : "Minhas turmas"}
        description={
          managed
            ? "Organize aulas, encontros e serviços com várias vagas no mesmo horário, em qualquer segmento."
            : "Consulte os participantes das suas turmas e registre a presença depois do início."
        }
        action={
          <Link
            href={`/painel/${companyId}/agenda`}
            className="button secondary"
          >
            Agenda individual
          </Link>
        }
      />
      <div className="class-context">
        <Icon name="users" size={22} />
        <p>
          Uma turma, um profissional e várias vagas. O controle de capacidade
          impede inscrições além do limite e protege os horários já ocupados.
        </p>
      </div>
      {!writable && (
        <p className="notice" role="status">
          As informações estão disponíveis para consulta. O acesso da empresa
          precisa estar ativo para fazer alterações.
        </p>
      )}
      {managed && company.booking_enabled && company.booking_slug && (
        <Link
          href={`/agendar/${company.booking_slug}/turmas`}
          className="class-public-link"
        >
          <Icon name="link" size={16} /> Ver inscrições públicas{" "}
          <Icon name="arrow-up-right" size={16} />
        </Link>
      )}
      <form className="panel class-filter" method="get">
        <label htmlFor="classes-day">
          Semana a partir de
          <input
            id="classes-day"
            type="date"
            name="day"
            defaultValue={day}
            min="1900-01-01"
            max="2099-12-31"
            required
          />
        </label>
        <button>Consultar</button>
        <Link href={route} className="button secondary">
          Hoje
        </Link>
      </form>
      <div className="classes-layout">
        <section aria-labelledby="classes-list-title">
          <div className="class-section-heading">
            <h2 id="classes-list-title">Próximas atividades no período</h2>
            <span>7 dias · São Paulo</span>
          </div>
          {sessions.error ? (
            <p role="alert" className="notice error">
              Não foi possível consultar as turmas. Atualize a página para
              tentar novamente.
            </p>
          ) : rows.length ? (
            <>
              <p className="class-help">
                {sessions.count ?? rows.length} turma(s) no período · até{" "}
                {classPageSize} por página.
              </p>
              <div className="class-list">
                {rows.map((session) => (
                  <Link
                    href={`${route}/${session.id}`}
                    className="panel class-list-card"
                    key={session.id}
                  >
                    <div className="class-date">
                      <span>{dateLabel(session.starts_at)}</span>
                      <strong>{appointmentTime(session.starts_at)}</strong>
                      <small>até {appointmentTime(session.ends_at)}</small>
                    </div>
                    <div className="class-list-copy">
                      <div className="class-badges">
                        <span className={`class-badge ${session.status}`}>
                          {classStatus[session.status]}
                        </span>
                        {session.is_public && (
                          <span className="class-badge">Inscrição pública</span>
                        )}
                      </div>
                      <h3>{session.title}</h3>
                      <p>
                        {relatedBusinessName(session.services)} ·{" "}
                        {relatedBusinessName(session.professionals)}
                      </p>
                      <span>
                        <Icon name="users" size={15} /> Capacidade:{" "}
                        {session.capacity}{" "}
                        {session.capacity === 1 ? "pessoa" : "pessoas"}
                      </span>
                    </div>
                    <Icon name="chevron-right" size={20} />
                  </Link>
                ))}
              </div>
              <nav className="class-pagination" aria-label="Páginas de turmas">
                {page > 1 && (
                  <Link className="button secondary" href={href(page - 1)}>
                    Anterior
                  </Link>
                )}
                <span>Página {page}</span>
                {page * classPageSize < (sessions.count || 0) && (
                  <Link className="button secondary" href={href(page + 1)}>
                    Próxima
                  </Link>
                )}
              </nav>
            </>
          ) : (
            <section className="panel">
              <EmptyState
                icon="users"
                title={
                  page > 1
                    ? "Nenhuma turma nesta página"
                    : "Espaço para reunir seus clientes"
                }
                description={
                  managed
                    ? "Crie uma atividade em grupo ou escolha outra data para consultar as turmas já cadastradas."
                    : "As turmas vinculadas ao seu profissional aparecerão aqui. Experimente consultar outra data."
                }
              >
                {page > 1 && (
                  <Link href={href(1)}>Voltar à primeira página</Link>
                )}
              </EmptyState>
            </section>
          )}
        </section>
        {managed && writable && (
          <section className="panel class-create" id="nova-turma">
            <div className="class-section-heading">
              <h2>Nova turma</h2>
              <Icon name="plus" size={20} />
            </div>
            <p className="class-help">
              Comece pelo serviço e pelo profissional que conduzirá a atividade.
            </p>
            {services?.error || professionals?.error ? (
              <p className="notice error" role="alert">
                Não foi possível carregar os cadastros. Atualize antes de criar
                uma turma.
              </p>
            ) : !services?.data?.length || !professionals?.data?.length ? (
              <EmptyState
                icon="calendar"
                title="Prepare os cadastros primeiro"
                description="Você precisa de pelo menos um serviço e um profissional ativo com horários configurados."
              >
                <Link
                  href={`/painel/${companyId}/configuracao`}
                  className="button"
                >
                  Abrir configuração
                </Link>
              </EmptyState>
            ) : (
              <ClassForm
                action={saveClass.bind(null, companyId, null)}
                services={services.data as ClassChoice[]}
                professionals={professionals.data as ClassChoice[]}
                day={day}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
