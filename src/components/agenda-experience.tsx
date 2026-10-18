"use client";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { createAppointment } from "@/app/painel/actions";
import { manageAppointment } from "@/app/painel/[companyId]/agenda/actions";
import {
  appointmentLanes,
  appointmentStatus,
  appointmentTime,
  saoPauloDay,
} from "@/lib/scheduling";
import { money } from "@/lib/catalog";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";

export type CalendarAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  professional_id: string;
  customer_name: string;
  service_name: string;
  professional_name: string;
};
type Option = { id: string; name: string };
type Props = {
  companyId: string;
  day: string;
  days: string[];
  view: "day" | "week";
  appointments: CalendarAppointment[];
  professionals: Option[];
  customers: Option[];
  services: (Option & { duration_minutes: number; price_cents: number })[];
  shifts: {
    professional_id: string;
    weekday: number;
    start_minute: number;
    end_minute: number;
  }[];
  managed: boolean;
  selectedProfessional: string;
};
function Submit({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-disabled={pending}>
      {pending ? "Salvando…" : children}
    </button>
  );
}
const minutes = (iso: string) => {
  const [h, m] = appointmentTime(iso).split(":").map(Number);
  return h * 60 + m;
};
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayLabel = (day: string, long = false) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: long ? "long" : "short",
    day: "2-digit",
    month: long ? "long" : "short",
  });

function AppointmentDialog({
  item,
  companyId,
  day,
  managed,
  onClose,
}: {
  item: CalendarAppointment;
  companyId: string;
  day: string;
  managed: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="appointment-dialog"
      onClose={onClose}
      aria-labelledby="appointment-title"
    >
      <div className="appointment-dialog-head">
        <span className={`appointment-status status-${item.status}`}>
          {appointmentStatus[item.status] || item.status}
        </span>
        <button
          className="secondary"
          onClick={() => dialog.current?.close()}
          aria-label="Fechar atendimento"
        >
          Fechar <Icon name="close" size={16} />
        </button>
      </div>
      <h2 id="appointment-title">{item.customer_name}</h2>
      <p className="appointment-service">
        <Icon name="briefcase" size={16} />
        {item.service_name} · {item.professional_name}
      </p>
      <div className="appointment-summary">
        <strong>
          <Icon name="calendar" size={16} />{" "}
          {dayLabel(saoPauloDay(new Date(item.starts_at)), true)}
        </strong>
        <span>
          {appointmentTime(item.starts_at)}–{appointmentTime(item.ends_at)}
        </span>
      </div>
      {managed && item.status === "scheduled" ? (
        <>
          <details>
            <summary>Remarcar atendimento</summary>
            <form action={manageAppointment}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="appointment_id" value={item.id} />
              <input type="hidden" name="operation" value="reschedule" />
              <input type="hidden" name="return_day" value={day} />
              <div className="form-grid">
                <label>
                  Nova data
                  <input
                    name="day"
                    type="date"
                    min="1900-01-01"
                    max="2099-12-31"
                    defaultValue={saoPauloDay(new Date(item.starts_at))}
                    required
                  />
                </label>
                <label>
                  Novo horário
                  <input
                    name="time"
                    type="time"
                    defaultValue={appointmentTime(item.starts_at)}
                    step={60}
                    required
                  />
                </label>
              </div>
              <p className="muted">
                A duração e o profissional serão mantidos. Confirmaremos a
                disponibilidade ao salvar.
              </p>
              <Submit>
                Confirmar remarcação <Icon name="check" size={16} />
              </Submit>
            </form>
          </details>
          {Date.parse(item.ends_at) <= Date.now() && (
            <form action={manageAppointment}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="appointment_id" value={item.id} />
              <input type="hidden" name="operation" value="complete" />
              <input type="hidden" name="return_day" value={day} />
              <Submit>
                Marcar como concluído <Icon name="check" size={16} />
              </Submit>
            </form>
          )}
          <details className="cancel-details">
            <summary>Cancelar agendamento</summary>
            <form action={manageAppointment}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="appointment_id" value={item.id} />
              <input type="hidden" name="operation" value="cancel" />
              <input type="hidden" name="return_day" value={day} />
              <label className="cancel-confirm">
                <input type="checkbox" name="confirm_cancel" required />
                Confirmo o cancelamento deste agendamento.
              </label>
              <Submit className="secondary">Cancelar e liberar horário</Submit>
            </form>
          </details>
        </>
      ) : (
        <p className="muted">
          {item.status !== "scheduled"
            ? "Este atendimento permanece no histórico."
            : "Seu acesso permite consultar este atendimento."}
        </p>
      )}
    </dialog>
  );
}

export function AgendaExperience(props: Props) {
  const {
    companyId,
    day,
    days,
    view,
    appointments,
    professionals,
    customers,
    services,
    managed,
    selectedProfessional,
    shifts,
  } = props;
  const [selected, setSelected] = useState<CalendarAppointment | null>(null);
  const [formDay, setFormDay] = useState(day);
  const [formTime, setFormTime] = useState("09:00");
  const [formProfessional, setFormProfessional] = useState(
    selectedProfessional ||
      (professionals.length === 1 ? professionals[0].id : ""),
  );
  const dateInput = useRef<HTMLInputElement>(null);
  const live = appointments.filter((a) => a.status !== "canceled");
  const visibleWeekdays = days.map(
    (d) => new Date(`${d}T12:00:00Z`).getUTCDay() || 7,
  );
  const visibleShifts = shifts.filter(
    (s) =>
      visibleWeekdays.includes(s.weekday) &&
      (!selectedProfessional || s.professional_id === selectedProfessional),
  );
  const startHour = Math.min(
    8,
    ...live.map((a) => Math.floor(minutes(a.starts_at) / 60)),
    ...visibleShifts.map((s) => Math.floor(s.start_minute / 60)),
  );
  const endHour = Math.max(
    19,
    ...live.map((a) => Math.ceil(minutes(a.ends_at) / 60)),
    ...visibleShifts.map((s) => Math.ceil(s.end_minute / 60)),
  );
  const totalMinutes = (endHour - startHour) * 60;
  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => startHour + i,
  );
  const columns =
    view === "week"
      ? days.map((d) => ({
          key: d,
          day: d,
          professional: "",
          title: dayLabel(d),
        }))
      : (selectedProfessional
          ? professionals.filter((p) => p.id === selectedProfessional)
          : professionals
        ).map((p) => ({ key: p.id, day, professional: p.id, title: p.name }));
  const ready = Boolean(
    customers.length && services.length && professionals.length,
  );
  const openSlot = (targetDay: string, hour: number, professional: string) => {
    setFormDay(targetDay);
    setFormTime(`${String(hour).padStart(2, "0")}:00`);
    if (professional) setFormProfessional(professional);
    dateInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    dateInput.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="agenda-overview">
        <div className="agenda-period-stat">
          <span className="agenda-stat-icon">
            <Icon name="calendar" size={18} />
          </span>
          <strong>{live.length}</strong>
          <span>atendimentos no período</span>
        </div>
        <div className="agenda-period-stat">
          <span className="agenda-stat-icon completed">
            <Icon name="check" size={18} />
          </span>
          <strong>{live.filter((a) => a.status === "completed").length}</strong>
          <span>concluídos</span>
        </div>
        <div className="agenda-legend">
          <span className="agenda-dot" aria-hidden="true" />
          Agendado <span className="agenda-dot done" aria-hidden="true" />
          Concluído
        </div>
      </div>
      {!appointments.length && (
        <div className="agenda-empty">
          <Icon name="calendar" size={20} />
          <p>
            <strong>Nenhum agendamento neste período.</strong>{" "}
            {managed
              ? "Escolha uma hora na agenda ou use Novo agendamento."
              : "Os seus próximos atendimentos aparecerão aqui."}
          </p>
        </div>
      )}
      {columns.length ? (
        <div
          className="calendar-scroll"
          role="region"
          aria-label="Calendário de atendimentos"
          tabIndex={0}
        >
          <div
            className="calendar"
            style={{
              gridTemplateColumns: `58px repeat(${columns.length}, minmax(${view === "week" ? 150 : 205}px, 1fr))`,
            }}
          >
            <div className="calendar-corner">Horário</div>
            {columns.map((column) => (
              <div
                key={column.key}
                className={`calendar-column-title ${column.day === saoPauloDay() ? "is-today" : ""}`}
              >
                <strong>{column.title}</strong>
                {view === "day" && <small>{dayLabel(day)}</small>}
              </div>
            ))}
            <div
              className="calendar-hours"
              style={{ height: totalMinutes * 1.5 }}
            >
              {hours.map((h) => (
                <span key={h} style={{ top: (h - startHour) * 90 }}>
                  {clock(h * 60)}
                </span>
              ))}
            </div>
            {columns.map((column) => {
              const weekday =
                new Date(`${column.day}T12:00:00Z`).getUTCDay() || 7;
              const columnItems = live.filter(
                (a) =>
                  saoPauloDay(new Date(a.starts_at)) === column.day &&
                  (!column.professional ||
                    column.professional === a.professional_id),
              );
              const columnShifts = shifts.filter(
                (s) =>
                  s.weekday === weekday &&
                  (!column.professional ||
                    s.professional_id === column.professional) &&
                  (!selectedProfessional ||
                    s.professional_id === selectedProfessional),
              );
              return (
                <div
                  key={column.key}
                  className="calendar-day"
                  style={{ height: totalMinutes * 1.5 }}
                >
                  {columnShifts.map((shift, index) => {
                    const start = Math.max(startHour * 60, shift.start_minute),
                      end = Math.min(endHour * 60, shift.end_minute);
                    return (
                      end > start && (
                        <div
                          key={index}
                          className="calendar-shift"
                          style={{
                            top: (start - startHour * 60) * 1.5,
                            height: (end - start) * 1.5,
                          }}
                          aria-hidden="true"
                        />
                      )
                    );
                  })}
                  {hours.map((h) =>
                    managed && ready ? (
                      <button
                        key={h}
                        className="calendar-slot"
                        style={{ top: (h - startHour) * 90 }}
                        aria-label={`Novo agendamento ${dayLabel(column.day)} às ${clock(h * 60)}${column.professional ? ` com ${column.title}` : ""}`}
                        onClick={() =>
                          openSlot(column.day, h, column.professional)
                        }
                      >
                        <span>
                          <Icon name="plus" size={12} /> {clock(h * 60)}
                        </span>
                      </button>
                    ) : (
                      <div
                        key={h}
                        className="calendar-line"
                        style={{ top: (h - startHour) * 90 }}
                      />
                    ),
                  )}
                  {appointmentLanes(columnItems).map(
                    ({ event, lane, lanes }) => (
                      <button
                        key={event.id}
                        className={`calendar-event event-${event.status}`}
                        style={{
                          top:
                            (minutes(event.starts_at) - startHour * 60) * 1.5,
                          height: Math.max(
                            7,
                            ((Date.parse(event.ends_at) -
                              Date.parse(event.starts_at)) /
                              60000) *
                              1.5 -
                              3,
                          ),
                          left: `calc(${(lane / lanes) * 100}% + 3px)`,
                          width: `calc(${100 / lanes}% - 6px)`,
                        }}
                        onClick={() => setSelected(event)}
                        aria-label={`${appointmentTime(event.starts_at)}, ${event.customer_name}, ${event.service_name}, ${event.professional_name}, ${appointmentStatus[event.status]}`}
                      >
                        <b>
                          {appointmentTime(event.starts_at)} ·{" "}
                          {event.customer_name}
                        </b>
                        <span>{event.service_name}</span>
                        {view === "week" && (
                          <small>{event.professional_name}</small>
                        )}
                      </button>
                    ),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon="user"
          title="Prepare sua agenda"
          description="Cadastre um profissional para começar a organizar os horários."
        />
      )}
      <p className="calendar-caption">
        <Icon name="clock" size={14} /> A faixa colorida indica os turnos
        cadastrados. Clique em um atendimento para ver os detalhes. A
        disponibilidade é confirmada ao salvar.
      </p>
      {appointments.length > 0 && (
        <details className="agenda-list">
          <summary>
            Ver lista de atendimentos e cancelamentos ({appointments.length})
          </summary>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                Lista de atendimentos e cancelamentos do período selecionado
              </caption>
              <thead>
                <tr>
                  <th scope="col">Data e hora</th>
                  <th scope="col">Cliente / serviço</th>
                  <th scope="col">Profissional</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {dayLabel(saoPauloDay(new Date(item.starts_at)))}
                      <br />
                      {appointmentTime(item.starts_at)}–
                      {appointmentTime(item.ends_at)}
                    </td>
                    <td>
                      <strong>{item.customer_name}</strong>
                      <br />
                      {item.service_name}
                    </td>
                    <td>{item.professional_name}</td>
                    <td>
                      <span
                        className={`appointment-status status-${item.status}`}
                      >
                        {appointmentStatus[item.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setSelected(item)}
                      >
                        Abrir <Icon name="arrow-up-right" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {managed && (
        <section className="panel appointment-create" id="novo-agendamento">
          <div>
            <span className="agenda-create-icon">
              <Icon name="plus" size={20} />
            </span>
            <h2>Novo agendamento</h2>
            <p>
              Escolha os dados do atendimento. A duração vem do serviço
              cadastrado.
            </p>
          </div>
          {!ready ? (
            <div className="notice">
              Antes de agendar, cadastre{" "}
              {!customers.length && (
                <Link href={`/painel/${companyId}/customers`}>um cliente </Link>
              )}
              {!services.length && (
                <Link href={`/painel/${companyId}/services`}>um serviço </Link>
              )}
              {!professionals.length && (
                <Link href={`/painel/${companyId}/professionals`}>
                  um profissional
                </Link>
              )}
              .
            </div>
          ) : (
            <form action={createAppointment}>
              <input type="hidden" name="company_id" value={companyId} />
              <div className="form-grid">
                <label>
                  Cliente
                  <select name="customer_id" required defaultValue="">
                    <option value="">Selecione o cliente</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Serviço
                  <select name="service_id" required defaultValue="">
                    <option value="">Selecione o serviço</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.duration_minutes} min ·{" "}
                        {money(s.price_cents)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Profissional
                  <select
                    name="professional_id"
                    required
                    value={formProfessional}
                    onChange={(e) => setFormProfessional(e.target.value)}
                  >
                    <option value="">Selecione o profissional</option>
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data
                  <input
                    ref={dateInput}
                    type="date"
                    name="day"
                    min="1900-01-01"
                    max="2099-12-31"
                    value={formDay}
                    onChange={(e) => setFormDay(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Horário
                  <input
                    name="time"
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    step={60}
                    required
                  />
                </label>
              </div>
              <Submit>
                Salvar agendamento <Icon name="check" size={16} />
              </Submit>
            </form>
          )}
        </section>
      )}
      {selected && (
        <AppointmentDialog
          key={selected.id}
          item={selected}
          companyId={companyId}
          day={day}
          managed={managed}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
