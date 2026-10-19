import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage, hasAccess } from "@/lib/permissions";
import { addDays, agendaRange, saoPauloDay, validDay } from "@/lib/scheduling";
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
  const managed =
    canManage(role) && hasAccess(company.status, company.trial_ends_at);
  const professionals = await db
    .from("professionals")
    .select("id,name")
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
      "id,starts_at,ends_at,status,professional_id,customers(name),services(name),professionals(name)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at")
    .limit(500);
  if (selectedProfessional)
    query = query.eq("professional_id", selectedProfessional);
  const [appointments, customers, services, shifts] = await Promise.all([
    query,
    managed
      ? db
          .from("customers")
          .select("id,name")
          .eq("company_id", companyId)
          .order("name")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    managed
      ? db
          .from("services")
          .select("id,name,duration_minutes,price_cents")
          .eq("company_id", companyId)
          .order("name")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("availability")
      .select("professional_id,weekday,start_minute,end_minute")
      .eq("company_id", companyId),
  ]);
  const failed = Boolean(
    appointments.error ||
      professionals.error ||
      customers.error ||
      services.error ||
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
      professional_id: item.professional_id,
      customer_name: relatedName(item.customers),
      service_name: relatedName(item.services),
      professional_name: relatedName(item.professionals),
    }),
  );
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
          <a className="button" href="#novo-agendamento">
            ＋ Novo agendamento
          </a>
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
          {(appointments.count || 0) > 500 && (
            <p className="notice">
              Exibindo os primeiros 500 atendimentos. Filtre um profissional ou
              use a visão diária para ver os demais.
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
            customers={customers.data || []}
            services={services.data || []}
            shifts={shifts.data || []}
            managed={managed}
            selectedProfessional={selectedProfessional || ""}
          />
        </>
      )}
    </section>
  );
}
