import { addDays, saoPauloDay, validDay } from "./scheduling";

export const dashboardPresets = [
  { value: "hoje", label: "Hoje", days: 1 },
  { value: "7", label: "7 dias", days: 7 },
  { value: "30", label: "30 dias", days: 30 },
  { value: "90", label: "90 dias", days: 90 },
] as const;

export type DashboardRange = {
  period: string;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  days: number;
  error: string | null;
};

/** Dates stay in São Paulo calendar days. The database computes UTC boundaries. */
export function dashboardRange(
  query: { periodo?: unknown; inicio?: unknown; fim?: unknown },
  now = new Date(),
): DashboardRange {
  const today = saoPauloDay(now);
  const preset = dashboardPresets.find((item) => item.value === query.periodo);
  let days: number = preset?.days ?? 30;
  let end = today;
  let start = addDays(end, 1 - days);
  let period: string = preset?.value ?? "30";
  let error: string | null = null;
  if (query.periodo === "personalizado") {
    const { inicio, fim } = query;
    if (validDay(inicio) && validDay(fim) && inicio <= fim && fim <= today) {
      const duration =
        (Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) /
          86_400_000 +
        1;
      if (duration <= 90) {
        start = inicio;
        end = fim;
        days = duration;
        period = "personalizado";
      } else {
        error =
          "Escolha um período de até 90 dias. Exibindo os últimos 30 dias.";
      }
    } else {
      error =
        "Informe datas válidas, em ordem e até hoje. Exibindo os últimos 30 dias.";
    }
  } else if (query.periodo !== undefined && !preset) {
    error = "Período não reconhecido. Exibindo os últimos 30 dias.";
  }
  return {
    period,
    start,
    end,
    days,
    previousStart: addDays(start, -days),
    previousEnd: addDays(start, -1),
    error,
  };
}

export type DashboardTotals = {
  appointments: number;
  scheduled: number;
  completed: number;
  canceled: number;
  attended_customers: number;
};

export type DashboardDay = {
  day: string;
  appointments: number;
  completed: number;
  canceled: number;
  new_customers: number | null;
};

export type DashboardData = {
  scope: "company" | "personal";
  current: DashboardTotals;
  previous: DashboardTotals;
  customers: {
    total: number;
    new: number;
    previous_new: number;
    without_created_at: number;
  } | null;
  daily: DashboardDay[];
  financial_available: false;
};

/** At most 14 touch targets; no values are dropped or averaged. */
export function dashboardBuckets(days: DashboardDay[]) {
  const size = Math.max(1, Math.ceil(days.length / 14));
  const buckets: {
    first: string;
    last: string;
    appointments: number;
    completed: number;
    canceled: number;
    new_customers: number | null;
  }[] = [];
  for (let index = 0; index < days.length; index += size) {
    const group = days.slice(index, index + size);
    buckets.push({
      first: group[0].day,
      last: group[group.length - 1].day,
      appointments: group.reduce((sum, day) => sum + day.appointments, 0),
      completed: group.reduce((sum, day) => sum + day.completed, 0),
      canceled: group.reduce((sum, day) => sum + day.canceled, 0),
      new_customers: group.every((day) => day.new_customers === null)
        ? null
        : group.reduce((sum, day) => sum + (day.new_customers ?? 0), 0),
    });
  }
  return buckets;
}

export function dashboardGrowth(current: number, previous: number) {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    current < 0 ||
    previous <= 0
  )
    return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function dashboardDate(day: string, full = false) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: full ? "short" : "2-digit",
    ...(full ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

export function dashboardPeriodLabel(start: string, end: string) {
  return start === end
    ? dashboardDate(start, true)
    : `${dashboardDate(start, true)} a ${dashboardDate(end, true)}`;
}
