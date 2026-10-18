export const APPOINTMENT_ZONE = "America/Sao_Paulo";
export const appointmentStatus: Record<string, string> = {
  scheduled: "Agendado",
  completed: "Concluído",
  canceled: "Cancelado",
};

function isDateKey(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1
  )
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function validDay(value: unknown): value is string {
  return (
    isDateKey(value) &&
    Number(value.slice(0, 4)) >= 1900 &&
    Number(value.slice(0, 4)) <= 2099
  );
}

export function saoPauloDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APPOINTMENT_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function appointmentTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: APPOINTMENT_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Convert local wall time without depending on the browser/server timezone. */
export function localAppointmentInstant(
  day: string,
  time: string,
): string | null {
  if (!isDateKey(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const target = Date.parse(`${day}T${time}:00Z`);
  let instant = target;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: APPOINTMENT_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = Object.fromEntries(
      format
        .formatToParts(new Date(instant))
        .map(({ type, value }) => [type, value]),
    );
    const displayed = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    if (displayed === target) return new Date(instant).toISOString();
    instant += target - displayed;
  }
  return null; // A wall time skipped by a timezone transition is not bookable.
}

export function agendaRange(day: string, view: "day" | "week") {
  const first = view === "week" ? weekStart(day) : day;
  const count = view === "week" ? 7 : 1;
  const boundary = (date: string) => {
    for (let hour = 0; hour < 4; hour++) {
      const instant = localAppointmentInstant(
        date,
        `${String(hour).padStart(2, "0")}:00`,
      );
      if (instant) return instant;
    }
    throw new Error("Invalid calendar boundary");
  };
  return {
    first,
    days: Array.from({ length: count }, (_, index) => addDays(first, index)),
    start: boundary(first),
    end: boundary(addDays(first, count)),
  };
}

export type TimedAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
};
/** Partition simultaneous events into lanes. Adjacent intervals share a lane. */
export function appointmentLanes<T extends TimedAppointment>(events: T[]) {
  const sorted = [...events].sort(
    (a, b) =>
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      Date.parse(b.ends_at) - Date.parse(a.ends_at),
  );
  const output: { event: T; lane: number; lanes: number }[] = [];
  let group: typeof output = [];
  let ends: number[] = [];
  const flush = () => {
    for (const item of group) item.lanes = ends.length;
    output.push(...group);
    group = [];
    ends = [];
  };
  for (const event of sorted) {
    const start = Date.parse(event.starts_at);
    if (ends.length && ends.every((end) => end <= start)) flush();
    let lane = ends.findIndex((end) => end <= start);
    if (lane === -1) lane = ends.length;
    ends[lane] = Date.parse(event.ends_at);
    group.push({ event, lane, lanes: 1 });
  }
  flush();
  return output;
}
