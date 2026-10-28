import test from "node:test";
import assert from "node:assert/strict";
import {
  teamCsvCell,
  teamInsightsCsv,
  teamInsightsSchema,
  teamPeriod,
} from "../src/lib/team-insights";

test("team periods use inclusive dates and enforce the plan's 31/90 day limits", () => {
  assert.equal(
    teamPeriod({ from: "2026-01-01", to: "2026-01-31" }, 31).error,
    null,
  );
  assert.match(
    teamPeriod({ from: "2026-01-01", to: "2026-02-01" }, 31).error!,
    /31/,
  );
  assert.equal(
    teamPeriod({ from: "2026-01-01", to: "2026-03-31" }, 90).error,
    null,
  );
  assert.match(
    teamPeriod({ from: "2026-01-01", to: "2026-04-01" }, 90).error!,
    /90/,
  );
  for (const input of [
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-10-22", to: "2026-10-21" },
    { from: ["2026-10-01"], to: "2026-10-21" },
    { from: "2026-10-01" },
  ]) {
    assert.ok(teamPeriod(input, 31).error);
  }
});

test("team default period uses São Paulo date rather than the server's UTC day", () => {
  assert.deepEqual(teamPeriod({}, 31, new Date("2026-10-22T01:00:00Z")), {
    from: "2026-09-22",
    to: "2026-10-21",
    error: null,
  });
});

test("CSV neutralizes formulas even after whitespace and control characters", () => {
  for (const name of [
    "=HYPERLINK(1)",
    "+1",
    "-2",
    "@SUM(A1)",
    " \t=1",
    "\r\n+1",
    "\u0000@SUM(A1)",
  ]) {
    assert.ok(teamCsvCell(name).startsWith("\"'"));
  }
  assert.equal(teamCsvCell('Ana; "Equipe"'), '"Ana; ""Equipe"""');
  assert.equal(teamCsvCell("Ana\nSilva"), '"Ana Silva"');
  assert.equal(teamCsvCell(10), '"10"');
});

test("team report validates numeric counts and exports only aggregate operational data", () => {
  const counts = {
    total: 2,
    scheduled: 1,
    completed: 1,
    canceled: 0,
    confirmed: 1,
    booked_minutes: 90,
  };
  const input = {
    period: { from: "2026-10-21", to: "2026-10-21" },
    timezone: "America/Sao_Paulo",
    max_days: 31,
    professionals: [
      {
        professional_id: "11111111-1111-4111-8111-111111111111",
        name: "=Nome",
        archived: false,
        ...counts,
      },
    ],
    totals: counts,
  };
  const report = teamInsightsSchema.parse(input);
  const csv = teamInsightsCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=Nome"/);
  assert.match(csv, /"TOTAL"/);
  assert.doesNotMatch(csv, /faturamento|receita|telefone|cliente/i);
  assert.equal(csv.split("\r\n").length, 4);
  assert.equal(
    teamInsightsSchema.safeParse({
      ...input,
      totals: { ...counts, completed: -1 },
    }).success,
    false,
  );
});
