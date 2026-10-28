import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage } from "@/lib/permissions";
import { addDays, agendaRange, saoPauloDay, validDay } from "@/lib/scheduling";
import { BLOCKS_PAGE_SIZE, blockPage } from "@/lib/schedule-blocks";
import { ScheduleBlockList } from "@/components/scheduling-blocks/block-list";
import {
  AgendaExperience,
  type CalendarAppointment,
} from "@/components/agenda-experience";
import "./agenda.css";

const notices: Record<string, string> = {
  criado: "Agendamento criado.",
  cancel: "Agendamento cancelado. O horário está livre novamente.",
  reschedule: "Agendamento remarcado.",
  complete: "Atendimento marcado como concluído.",
};
export default async function Agenda({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    day?: string;
    view?: string;
    professional?: string;
    erro?: string;
    notice?: string;
    bloqueios_pagina?: string;
  }>;
}) {
  const { companyId } = await params;
  const q = await searchParams;
  const { db, role, company } = await requireCompany(companyId);
  const day = validDay(q.day) ? q.day : saoPauloDay();
  const view =
    q.view === "day" || q.view === "week"
      ? q.view
      : company.agenda_view === "week"
        ? "week"
        : "day";
  const range = agendaRange(day, view);
  const managed = canManage(role) && company.access_valid;
  const professionals = await db
    .from("professionals")
    .select("id,name,archived_at")
    .eq("company_id", companyId)
    .order("name");
  const selectedProfessional = professionals.data?.some(
    (p) => p.id === q.professional,
  )
    ? q.professional
    : "";
  let query = db
    .from("appointments")
    .select(
      "id,starts_at,ends_at,status,professional_id,attendance_confirmed_at,booking_details,customers(name),services(name),professionals(name)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at")
    .limit(500);
  if (selectedProfessional)
    query = query.eq("professional_id", selectedProfessional);
  let classesQuery = db
    .from("class_sessions")
    .select(
      "id,title,starts_at,ends_at,status,professional_id,capacity,services(name),professionals(name)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at")
    .limit(500);
  if (selectedProfessional)
    classesQuery = classesQuery.eq("professional_id", selectedProfessional);
  const blocksPage = blockPage(q.bloqueios_pagina);
  let blocksQuery = db
    .from("schedule_blocks")
    .select("id,professional_id,starts_at,ends_at,reason", { count: "exact" })
    .eq("company_id", companyId)
    .lt("starts_at", range.end)
    .gt("ends_at", range.start)
    .order("starts_at")
    .order("id")
    .range(
      (blocksPage - 1) * BLOCKS_PAGE_SIZE,
      blocksPage * BLOCKS_PAGE_SIZE - 1,
    );
  if (selectedProfessional)
    blocksQuery = blocksQuery.or(
      `professional_id.is.null,professional_id.eq.${selectedProfessional}`,
    );
  const [
    appointments,
    customers,
    services,
    shifts,
    bookingProfessionals,
    blocks,
    classes,
  ] = await Promise.all([
    query,
    managed
      ? db
          .from("customers")
          .select("id,name")
          .eq("company_id", companyId)
          .is("archived_at", null)
          .order("name")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    managed
      ? db
          .from("services")
          .select("id,name,duration_minutes,price_cents")
          .eq("company_id", companyId)
          .is("archived_at", null)
          .order("name")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("availability")
      .select("professional_id,weekday,start_minute,end_minute")
      .eq("company_id", companyId),
    managed
      ? db
          .from("professionals")
          .select("id,name")
          .eq("company_id", companyId)
          .is("archived_at", null)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    blocksQuery,
    classesQuery,
  ]);
  const failed = Boolean(
    appointments.error ||
      classes.error ||
      professionals.error ||
      customers.error ||
      services.error ||
      bookingProfessionals.error ||
      shifts.error,
  );
  const relatedName = (value: unknown) => {
    const relation = Array.isArray(value) ? value[0] : value;
    return relation && typeof relation === "object" && "name" in relation
      ? String(relation.name)
      : "Cadastro indisponível";
  };
  const items: CalendarAppointment[] = (appointments.data || []).map(
    (item) => ({
      id: item.id,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      status: item.status,
      attendance_confirmed_at: item.attendance_confirmed_at,
      professional_id: item.professional_id,
      customer_name: relatedName(item.customers),
      service_name: relatedName(item.services),
      professional_name: relatedName(item.professionals),
    }),
  );
  for (const session of classes.data || [])
    items.push({
      id: session.id,
      kind: "class",
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      status: session.status,
      professional_id: session.professional_id,
      customer_name: `Turma · ${session.title}`,
      service_name: `${relatedName(session.services)} · limite de ${session.capacity} participantes`,
      professional_name: relatedName(session.professionals),
    });
  items.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const href = (target: string, mode = view) =>
    `/painel/${companyId}/agenda?${new URLSearchParams({ day: target, view: mode, ...(selectedProfessional ? { professional: selectedProfessional } : {}) })}`;
  return (
    <section className="agenda-page">
      <header className="agenda-heading">
        <div>
          <span className="tag">SUA ROTINA, EM ORDEM</span>
          <h1>Agenda</h1>
          <p>Horários, clientes e equipe em uma só visão. Fuso de São Paulo.</p>
        </div>
        {managed && (
          <div className="agenda-heading-actions">
            <Link
              className="button secondary"
              href={`/painel/${companyId}/agenda/importar`}
            >
              Importar agenda
            </Link>
            <Link
              className="button secondary"
              href={`/painel/${companyId}/turmas`}
            >
              Turmas e vagas
            </Link>
            <a className="button" href="#novo-agendamento">
              ＋ Novo agendamento
            </a>
          </div>
        )}
      </header>
      {q.notice && notices[q.notice] && (
        <p className="notice" role="status">
          {notices[q.notice]}
        </p>
      )}
      {q.erro && (
        <p className="notice error" role="alert">
          {q.erro === "confirmacao"
            ? "Confirme o cancelamento antes de continuar."
            : "Não foi possível salvar. Confira a data, a disponibilidade e se o atendimento já foi alterado. Os dados anteriores foram preservados."}
        </p>
      )}
      <div className="agenda-toolbar">
        <div className="agenda-period">
          <Link
            className="secondary button"
            aria-label="Período anterior"
            href={href(addDays(day, view === "week" ? -7 : -1))}
          >
            ←
          </Link>
          <Link className="secondary button" href={href(saoPauloDay())}>
            Hoje
          </Link>
          <Link
            className="secondary button"
            aria-label="Próximo período"
            href={href(addDays(day, view === "week" ? 7 : 1))}
          >
            →
          </Link>
        </div>
        <form
          key={`${day}:${view}:${selectedProfessional}`}
          className="agenda-filters"
        >
          <input type="hidden" name="view" value={view} />
          <label>
            Data
            <input
              aria-label="Data da agenda"
              type="date"
              name="day"
              min="1900-01-01"
              max="2099-12-31"
              defaultValue={day}
              required
            />
          </label>
          <label>
            Profissional
            <select name="professional" defaultValue={selectedProfessional}>
              <option value="">Todos os profissionais</option>
              {professionals.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived_at ? " (arquivado)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary">Filtrar</button>
        </form>
        <div className="agenda-switch" aria-label="Visualização">
          <Link
            aria-current={view === "day" ? "page" : undefined}
            href={href(day, "day")}
          >
            Dia
          </Link>
          <Link
            aria-current={view === "week" ? "page" : undefined}
            href={href(day, "week")}
          >
            Semana
          </Link>
        </div>
      </div>
      {failed ? (
        <p className="notice error" role="alert">
          Não foi possível carregar a agenda. Atualize a página para tentar
          novamente.
        </p>
      ) : (
        <>
          {((appointments.count || 0) > 500 || (classes.count || 0) > 500) && (
            <p className="notice">
              Exibindo até 500 atendimentos e 500 turmas. Filtre um profissional
              ou use a visão diária para ver os demais.
            </p>
          )}
          <AgendaExperience
            key={`${day}:${view}:${selectedProfessional}`}
            companyId={companyId}
            day={day}
            days={range.days}
            view={view}
            appointments={items}
            professionals={professionals.data || []}
            bookingProfessionals={bookingProfessionals.data || []}
            customers={customers.data || []}
            services={services.data || []}
            shifts={shifts.data || []}
            managed={managed}
            selectedProfessional={selectedProfessional || ""}
          />
        </>
      )}
      <section
        className="panel schedule-block-panel"
        id="bloqueios"
        aria-labelledby="agenda-block-heading"
      >
        <div className="schedule-block-heading">
          <div>
            <h2 id="agenda-block-heading">Bloqueios neste período</h2>
            <p>
              De {range.first.split("-").reverse().join("/")} a{" "}
              {range.days.at(-1)!.split("-").reverse().join("/")}.{" "}
              {selectedProfessional
                ? "Inclui o profissional selecionado e bloqueios de toda a empresa."
                : "Períodos sem atendimento que você tem permissão para consultar."}
            </p>
          </div>
          {managed && (
            <Link
              className="button secondary"
              href={`/painel/${companyId}/disponibilidade?bloqueios_de=${range.first}#bloqueios`}
            >
              Gerenciar bloqueios
            </Link>
          )}
        </div>
        {blocks.error || professionals.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar os bloqueios. Atualize a página antes de
            escolher um novo horário.
          </p>
        ) : (
          <ScheduleBlockList
            blocks={blocks.data ?? []}
            professionals={professionals.data ?? []}
            page={blocksPage}
            total={blocks.count ?? 0}
            pageHref={(page) =>
              `${href(day)}&bloqueios_pagina=${page}#bloqueios`
            }
          />
        )}
      </section>
    </section>
  );
}
