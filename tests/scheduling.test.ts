import test from "node:test";
import assert from "node:assert/strict";
import {
  validDay,
  localAppointmentInstant,
  agendaRange,
  appointmentLanes,
  saoPauloDay,
} from "../src/lib/scheduling";

test("calendar validates dates and converts São Paulo wall time independent of host timezone", () => {
  assert.equal(validDay("2026-02-30"), false);
  assert.equal(validDay("2028-02-29"), true);
  assert.equal(validDay("invalid"), false);
  assert.equal(
    localAppointmentInstant("2026-10-20", "10:30"),
    "2026-10-20T13:30:00.000Z",
  );
  assert.equal(localAppointmentInstant("2026-10-20", "24:00"), null);
  assert.equal(saoPauloDay(new Date("2026-10-20T02:00:00Z")), "2026-10-19");
});
test("timezone conversion respects historical daylight saving and rejects skipped wall times", () => {
  assert.equal(
    localAppointmentInstant("2018-12-01", "10:00"),
    "2018-12-01T12:00:00.000Z",
  );
  assert.equal(localAppointmentInstant("2018-11-04", "00:30"), null);
});
test("week range crosses year boundaries and ends exclusively at next Monday", () => {
  const range = agendaRange("2026-01-01", "week");
  assert.equal(range.first, "2025-12-29");
  assert.equal(range.days.length, 7);
  assert.equal(range.end, "2026-01-05T03:00:00.000Z");
  assert.equal(
    agendaRange("2018-11-04", "day").start,
    "2018-11-04T03:00:00.000Z",
  );
  assert.ok(agendaRange("2000-01-01", "week").start.startsWith("1999-12-27"));
  assert.ok(agendaRange("2099-12-31", "week").end.startsWith("2100-01"));
});
test("simultaneous professionals remain separate while adjacent appointments reuse lanes", () => {
  const events = [
    {
      id: "a",
      starts_at: "2026-10-20T12:00:00Z",
      ends_at: "2026-10-20T13:00:00Z",
    },
    {
      id: "b",
      starts_at: "2026-10-20T12:30:00Z",
      ends_at: "2026-10-20T13:30:00Z",
    },
    {
      id: "c",
      starts_at: "2026-10-20T13:30:00Z",
      ends_at: "2026-10-20T14:00:00Z",
    },
  ];
  const layout = appointmentLanes(events);
  assert.deepEqual(
    layout.map((x) => [x.lane, x.lanes]),
    [
      [0, 2],
      [1, 2],
      [0, 1],
    ],
  );
  assert.equal(events[0].id, "a");
});
