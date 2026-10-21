import test from "node:test";
import assert from "node:assert/strict";
import {
  blockPage,
  blockValues,
  parseBlockRemoval,
  parseScheduleBlock,
  scheduleBlockError,
  type ScheduleBlockValues,
} from "../src/lib/schedule-blocks";

const id = "a62b6b42-bdb6-46c8-977f-178c901866e3";
const now = Date.parse("2026-10-20T11:00:00Z");
const values: ScheduleBlockValues = {
  request_id: id,
  professional_id: "",
  start_day: "2026-10-20",
  start_time: "09:00",
  end_day: "2026-10-20",
  end_time: "18:00",
  reason: "  Feriado  ",
};

test("blocks convert São Paulo times, keep UUID and distinguish whole company from a professional", () => {
  assert.deepEqual(parseScheduleBlock(values, now), {
    success: true,
    data: {
      id,
      professional: null,
      start: "2026-10-20T12:00:00.000Z",
      end: "2026-10-20T21:00:00.000Z",
      reason: "Feriado",
    },
  });
  const professional = parseScheduleBlock(
    { ...values, professional_id: id, reason: "" },
    now,
  );
  assert.ok(professional.success);
  assert.equal(professional.data.professional, id);
  assert.equal(professional.data.reason, "");
});

test("blocks reject impossible dates, invalid hours and missing identities", () => {
  for (const patch of [
    { start_day: "2026-02-30" },
    { end_day: "2026-02-29" },
    { start_day: "1899-12-31" },
    { end_day: "2100-01-01" },
    { start_time: "24:00" },
    { end_time: "10:60" },
    { request_id: "" },
    { professional_id: "foreign-looking-id" },
  ])
    assert.equal(
      parseScheduleBlock({ ...values, ...patch }, now).success,
      false,
    );
  assert.equal(
    parseScheduleBlock(
      { ...values, start_day: "2028-02-29", end_day: "2028-02-29" },
      now,
    ).success,
    true,
  );
});

test("blocks reject empty, reversed and expired intervals while allowing an ongoing or long absence", () => {
  assert.equal(
    parseScheduleBlock({ ...values, end_time: "09:00" }, now).success,
    false,
  );
  assert.equal(
    parseScheduleBlock({ ...values, end_time: "08:59" }, now).success,
    false,
  );
  assert.equal(
    parseScheduleBlock(
      { ...values, start_time: "06:00", end_time: "08:00" },
      now,
    ).success,
    false,
  );
  assert.equal(
    parseScheduleBlock({ ...values, start_time: "06:00" }, now).success,
    true,
  );
  assert.equal(
    parseScheduleBlock({ ...values, end_day: "2027-12-31" }, now).success,
    true,
  );
});

test("historical daylight-saving gaps are refused and valid historical wall times use their actual offset", () => {
  const historicalNow = Date.parse("2018-01-01T00:00:00Z");
  assert.equal(
    parseScheduleBlock(
      {
        ...values,
        start_day: "2018-11-04",
        start_time: "00:30",
        end_day: "2018-11-04",
      },
      historicalNow,
    ).success,
    false,
  );
  const historical = parseScheduleBlock(
    { ...values, start_day: "2018-12-01", end_day: "2018-12-01" },
    historicalNow,
  );
  assert.ok(historical.success);
  assert.equal(historical.data.start, "2018-12-01T11:00:00.000Z");
});

test("reason is trimmed, limited to 160 characters and preserved as plain text", () => {
  assert.equal(
    parseScheduleBlock({ ...values, reason: "a".repeat(160) }, now).success,
    true,
  );
  assert.equal(
    parseScheduleBlock({ ...values, reason: "a".repeat(161) }, now).success,
    false,
  );
  assert.equal(
    parseScheduleBlock({ ...values, reason: "🎉".repeat(160) }, now).success,
    true,
  );
  const result = parseScheduleBlock(
    { ...values, reason: "<script>alert(1)</script>" },
    now,
  );
  assert.ok(result.success);
  assert.equal(result.data.reason, "<script>alert(1)</script>");
});

test("removal needs explicit confirmation and a UUID even when invoked without UI", () => {
  const form = new FormData();
  form.set("block_id", id);
  for (const value of ["", "on", "true", "no"]) {
    form.set("confirm_action", value);
    assert.deepEqual(parseBlockRemoval(form), {
      success: false,
      error: "confirmar-bloqueio",
    });
  }
  form.set("confirm_action", "yes");
  assert.deepEqual(parseBlockRemoval(form), { success: true, id });
  form.set("block_id", "bad-id");
  assert.deepEqual(parseBlockRemoval(form), {
    success: false,
    error: "remover-bloqueio",
  });
});

test("form extraction bounds retained fields; pagination rejects malformed offsets", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  assert.deepEqual(blockValues(form), values);
  form.set("reason", "a".repeat(2000));
  assert.equal(blockValues(form).reason.length, 1000);
  assert.equal(parseScheduleBlock(blockValues(form), now).success, false);
  for (const value of [
    undefined,
    "0",
    "-1",
    "1.5",
    "2x",
    "1e5",
    "1000000",
    ["1"],
  ])
    assert.equal(blockPage(value), 1);
  assert.equal(blockPage("2"), 2);
});

test("database errors provide actionable feedback without echoing backend details", () => {
  assert.match(
    scheduleBlockError("scheduled appointment conflict"),
    /Nenhum agendamento foi alterado/,
  );
  assert.match(
    scheduleBlockError("professional unavailable"),
    /profissional ativo/,
  );
  assert.match(
    scheduleBlockError("block idempotency conflict"),
    /outros dados/,
  );
  assert.match(scheduleBlockError("invalid block interval"), /futuro/);
  assert.match(scheduleBlockError("invalid block reason"), /160/);
  assert.doesNotMatch(
    scheduleBlockError("private database credentials"),
    /private database credentials/,
  );
});
