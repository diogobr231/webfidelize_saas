import { z } from "zod";
import { addDays, saoPauloDay, validDay } from "./scheduling";

const counts = z.object({
  total: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  booked_minutes: z.number().int().nonnegative(),
});
export const teamInsightsSchema = z.object({
  period: z.object({
    from: z.string().refine(validDay),
    to: z.string().refine(validDay),
  }),
  timezone: z.literal("America/Sao_Paulo"),
  max_days: z.union([z.literal(31), z.literal(90)]),
  professionals: z.array(
    counts.extend({
      professional_id: z.uuid(),
      name: z.string(),
      archived: z.boolean(),
    }),
  ),
  totals: counts,
});
export type TeamInsights = z.infer<typeof teamInsightsSchema>;

export function teamPeriod(
  input: { from?: unknown; to?: unknown },
  maxDays: 31 | 90,
  now = new Date(),
) {
  const today = saoPauloDay(now);
  const fallback = { from: addDays(today, -29), to: today };
  if (input.from === undefined && input.to === undefined)
    return { ...fallback, error: null };
  if (!validDay(input.from) || !validDay(input.to))
    return {
      ...fallback,
      error: "Informe duas datas válidas para consultar o período.",
    };
  const days =
    (Date.parse(`${input.to}T12:00:00Z`) -
      Date.parse(`${input.from}T12:00:00Z`)) /
      86_400_000 +
    1;
  const error =
    days < 1
      ? "A data final precisa ser igual ou posterior à inicial."
      : days > maxDays
        ? `Seu plano permite consultar até ${maxDays} dias por vez.`
        : null;
  return { from: input.from, to: input.to, error };
}

/** A quoted CSV cell is not enough to prevent spreadsheet formula execution. */
export function teamCsvCell(value: string | number) {
  const clean = String(value).replace(/[\u0000-\u001f\u007f]/g, " ");
  const literal = /^\s*[=+\-@]/u.test(clean) ? `'${clean}` : clean;
  return `"${literal.replaceAll('"', '""')}"`;
}

export function teamInsightsCsv(report: TeamInsights) {
  const headers = [
    "Início",
    "Fim",
    "Fuso",
    "Profissional",
    "Cadastro",
    "Agendamentos",
    "Agendados",
    "Concluídos",
    "Cancelados",
    "Presenças confirmadas",
    "Minutos reservados sem cancelados",
  ];
  const row = (
    name: string,
    archived: string,
    data: TeamInsights["totals"],
  ) => [
    report.period.from,
    report.period.to,
    report.timezone,
    name,
    archived,
    data.total,
    data.scheduled,
    data.completed,
    data.canceled,
    data.confirmed,
    data.booked_minutes,
  ];
  return (
    "\uFEFF" +
    [
      headers,
      ...report.professionals.map((professional) =>
        row(
          professional.name,
          professional.archived ? "Arquivado" : "Ativo",
          professional,
        ),
      ),
      row("TOTAL", "", report.totals),
    ]
      .map((values) => values.map(teamCsvCell).join(";"))
      .join("\r\n") +
    "\r\n"
  );
}

export function bookedTime(minutes: number) {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}
