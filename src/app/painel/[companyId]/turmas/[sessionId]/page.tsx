import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { appointmentTime, saoPauloDay } from "@/lib/scheduling";
import {
  classPage,
  classRosterPageSize,
  classStatus,
  registrationStatus,
  type ClassChoice,
  type ClassRegistration,
  type ClassSession,
} from "@/lib/classes";
import { relatedBusinessName } from "@/lib/business-records";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { ClassForm } from "@/components/classes/class-form";
import {
  ClassMutationForm,
  ParticipantForm,
} from "@/components/classes/participant-form";
import {
  addClassParticipant,
  manageClass,
  manageClassParticipant,
  saveClass,
} from "../actions";
import "@/components/classes/classes.css";

export default async function ClassDetail({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; sessionId: string }>;
  searchParams: Promise<{ pagina?: string; cliente?: string; salvo?: string }>;
}) {
  const { companyId, sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) notFound();
  const { db, role, company } = await requireCompany(companyId);
  const query = await searchParams;
  const { data, error } = await db
    .from("class_sessions")
    .select(
      "id,company_id,service_id,professional_id,title,starts_at,ends_at,capacity,status,is_public,version,services(name),professionals(name)",
    )
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error("Turma temporariamente indisponível");
  if (!data) notFound();
  const session = data as unknown as ClassSession & {
    services: unknown;
    professionals: unknown;
  };
  const managed = canManage(role);
  const writable = company.access_valid;
  const scheduled = session.status === "scheduled";
  const started = Date.parse(session.starts_at) <= Date.now();
  const ended = Date.parse(session.ends_at) <= Date.now();
  const page = classPage(query.pagina);
  const search =
    typeof query.cliente === "string" ? query.cliente.trim().slice(0, 100) : "";
  const customerQuery = db
    .from("customers")
    .select("id,name")
    .eq("company_id", companyId)
    .is("archived_at", null)
    .order("name")
    .limit(50);
  if (search)
    customerQuery.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const [registrations, occupied, customers, services, professionals] =
    await Promise.all([
      db
        .from("class_registrations")
        .select("id,customer_id,status,version,customers(name)", {
          count: "exact",
        })
        .eq("company_id", companyId)
        .eq("class_session_id", sessionId)
        .order("created_at")
        .order("id")
        .range(
          (page - 1) * classRosterPageSize,
          page * classRosterPageSize - 1,
        ),
      db
        .from("class_registrations")
        .select("id", { head: true, count: "exact" })
        .eq("company_id", companyId)
        .eq("class_session_id", sessionId)
        .neq("status", "canceled"),
      managed && writable && scheduled && !started
        ? customerQuery
        : Promise.resolve(null),
      managed && writable && scheduled && !started
        ? db
            .from("services")
            .select("id,name,duration_minutes,archived_at")
            .eq("company_id", companyId)
            .order("name")
            .limit(500)
        : Promise.resolve(null),
      managed && writable && scheduled && !started
        ? db
            .from("professionals")
            .select("id,name,archived_at")
            .eq("company_id", companyId)
            .order("name")
            .limit(100)
        : Promise.resolve(null),
    ]);
  const rows = (registrations.data ?? []) as unknown as ClassRegistration[];
  const count = occupied.error ? null : occupied.count;
  const remaining =
    count === null ? null : Math.max(0, session.capacity - count);
  const route = `/painel/${companyId}/turmas/${sessionId}`;
  const date = new Date(session.starts_at).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  const messages: Record<string, string> = {
    turma: "Turma salva.",
    inscrito: "Participante inscrito.",
    presenca: "Presença registrada.",
    "inscricao-cancelada": "Inscrição cancelada. A vaga foi liberada.",
    cancel: "Turma cancelada. O histórico foi preservado.",
    complete: "Turma marcada como concluída.",
  };
  return (
    <div className="classes-page">
      <Link
        href={`/painel/${companyId}/turmas?day=${saoPauloDay(new Date(session.starts_at))}`}
        className="class-back"
      >
        ← Voltar às turmas
      </Link>
      <PageHeader
        eyebrow="Turma e participantes"
        title={session.title}
        description={`${date} · ${appointmentTime(session.starts_at)} às ${appointmentTime(session.ends_at)} · São Paulo`}
      />
      {query.salvo && messages[query.salvo] && (
        <p className="notice" role="status">
          {messages[query.salvo]}
        </p>
      )}
      {!writable && (
        <p className="notice" role="status">
          A empresa está disponível para consulta. As alterações precisam de
          acesso ativo.
        </p>
      )}
      <section className="panel class-overview">
        <div>
          <span className={`class-badge ${session.status}`}>
            {classStatus[session.status]}
          </span>
          <h2>{relatedBusinessName(session.services)}</h2>
          <p>{relatedBusinessName(session.professionals)}</p>
        </div>
        <div className="class-capacity">
          <Icon name="users" size={24} />
          <strong>
            {count === null ? "—" : count}
            <small> / {session.capacity}</small>
          </strong>
          <span>
            {count === null
              ? "Ocupação indisponível"
              : `${remaining} vaga(s) livre(s)`}
          </span>
        </div>
      </section>
      {occupied.error && (
        <p className="notice error" role="alert">
          Não foi possível consultar a ocupação. Atualize antes de adicionar
          participantes.
        </p>
      )}
      {session.is_public && company.booking_enabled && company.booking_slug && (
        <Link
          className="class-public-link"
          href={`/agendar/${company.booking_slug}/turmas?day=${saoPauloDay(new Date(session.starts_at))}&turma=${session.id}`}
        >
          <Icon name="link" size={16} /> Abrir página de inscrição
        </Link>
      )}
      <div className="classes-layout">
        <section aria-labelledby="class-roster-title">
          <div className="class-section-heading">
            <h2 id="class-roster-title">Lista de participantes</h2>
            <span>
              {registrations.count === null
                ? ""
                : `${registrations.count} inscrição(ões)`}
            </span>
          </div>
          {registrations.error ? (
            <p role="alert" className="notice error">
              Não foi possível carregar os participantes. Atualize a página.
            </p>
          ) : rows.length ? (
            <>
              <div className="class-roster">
                {rows.map((registration) => (
                  <article
                    className="panel class-participant"
                    key={registration.id}
                  >
                    <div>
                      <h3>{relatedBusinessName(registration.customers)}</h3>
                      <span className={`class-badge ${registration.status}`}>
                        {registrationStatus[registration.status]}
                      </span>
                      {managed && (
                        <Link
                          className="class-small-link"
                          href={`/painel/${companyId}/customers/${registration.customer_id}`}
                        >
                          Abrir ficha do cliente
                        </Link>
                      )}
                    </div>
                    <div className="class-participant-actions">
                      {writable &&
                        scheduled &&
                        started &&
                        registration.status === "reserved" && (
                          <ClassMutationForm
                            action={manageClassParticipant.bind(
                              null,
                              companyId,
                              sessionId,
                              registration.id,
                            )}
                            version={registration.version}
                            operation="attend"
                            label="Marcar presença"
                          />
                        )}
                      {managed &&
                        writable &&
                        scheduled &&
                        registration.status === "reserved" && (
                          <ClassMutationForm
                            action={manageClassParticipant.bind(
                              null,
                              companyId,
                              sessionId,
                              registration.id,
                            )}
                            version={registration.version}
                            operation="cancel"
                            label="Cancelar inscrição"
                            confirmation="A vaga será liberada. O registro continuará no histórico desta turma."
                          />
                        )}
                    </div>
                  </article>
                ))}
              </div>
              <nav
                className="class-pagination"
                aria-label="Páginas de participantes"
              >
                {page > 1 && (
                  <Link
                    href={`${route}?pagina=${page - 1}`}
                    className="button secondary"
                  >
                    Anterior
                  </Link>
                )}
                <span>Página {page}</span>
                {page * classRosterPageSize < (registrations.count || 0) && (
                  <Link
                    href={`${route}?pagina=${page + 1}`}
                    className="button secondary"
                  >
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
                    ? "Nenhum participante nesta página"
                    : "A lista começa com a primeira inscrição"
                }
                description={
                  managed
                    ? "Adicione um cliente cadastrado ou abra as inscrições na página pública da empresa."
                    : "Os participantes inscritos nesta turma aparecerão aqui."
                }
              >
                {page > 1 && <Link href={route}>Voltar à primeira página</Link>}
              </EmptyState>
            </section>
          )}
        </section>
        <aside className="class-side">
          {managed &&
            writable &&
            scheduled &&
            !started &&
            remaining !== null &&
            remaining > 0 && (
              <section className="panel">
                <h2>Adicionar participante</h2>
                <form method="get" className="class-search">
                  <label htmlFor="class-customer-search">
                    Buscar cliente pelo nome
                    <input
                      id="class-customer-search"
                      name="cliente"
                      defaultValue={search}
                      maxLength={100}
                      placeholder="Digite parte do nome"
                    />
                  </label>
                  <button className="secondary">Buscar</button>
                </form>
                {customers?.error ? (
                  <p role="alert" className="notice error">
                    Não foi possível buscar os clientes.
                  </p>
                ) : customers?.data?.length ? (
                  <>
                    <ParticipantForm
                      action={addClassParticipant.bind(
                        null,
                        companyId,
                        sessionId,
                      )}
                      customers={customers.data as ClassChoice[]}
                      requestId={randomUUID()}
                    />
                    <p className="class-help">
                      Até 50 resultados. Refine a busca para encontrar outro
                      cliente.
                    </p>
                  </>
                ) : (
                  <p className="class-help">
                    Nenhum cliente ativo encontrado.{" "}
                    <Link href={`/painel/${companyId}/customers`}>
                      Abrir cadastro de clientes
                    </Link>
                    .
                  </p>
                )}
              </section>
            )}
          {managed && writable && scheduled && !started && (
            <details className="panel class-edit">
              <summary>Editar turma</summary>
              {services?.error || professionals?.error ? (
                <p role="alert" className="notice error">
                  Não foi possível carregar os cadastros para edição.
                </p>
              ) : (
                <ClassForm
                  action={saveClass.bind(null, companyId, sessionId)}
                  session={session}
                  services={
                    (services?.data ?? []).filter(
                      (item) =>
                        !item.archived_at || item.id === session.service_id,
                    ) as ClassChoice[]
                  }
                  professionals={
                    (professionals?.data ?? []).filter(
                      (item) =>
                        !item.archived_at ||
                        item.id === session.professional_id,
                    ) as ClassChoice[]
                  }
                  day={saoPauloDay(new Date(session.starts_at))}
                />
              )}
            </details>
          )}
          {managed && writable && scheduled && (
            <section className="panel">
              <h2>Gerenciar atividade</h2>
              <p className="class-help">
                A conclusão fica disponível depois do horário final. Cancelar
                preserva o histórico e impede novas inscrições.
              </p>
              {ended && (
                <ClassMutationForm
                  action={manageClass.bind(null, companyId, sessionId)}
                  version={session.version}
                  operation="complete"
                  label="Concluir turma"
                  confirmation="Confirme que esta atividade terminou. As presenças já registradas serão preservadas."
                />
              )}
              <ClassMutationForm
                action={manageClass.bind(null, companyId, sessionId)}
                version={session.version}
                operation="cancel"
                label="Cancelar turma"
                confirmation="As inscrições deixarão de valer e o intervalo do profissional será liberado. Avise os participantes; esta ação não envia mensagens."
              />
            </section>
          )}
          {!managed && (
            <section className="panel">
              <Icon name="shield" size={22} />
              <h2>Sua turma, sua lista</h2>
              <p className="class-help">
                Você pode registrar presença após o início. Mudanças de horário,
                vagas e inscrições são feitas pelo proprietário ou gerente.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
