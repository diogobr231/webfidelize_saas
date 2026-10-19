import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardBuckets,
  dashboardGrowth,
  dashboardRange,
  type DashboardDay,
} from "../src/lib/dashboard";
import { addDays } from "../src/lib/scheduling";

const now = new Date("2026-10-18T01:30:00Z"); // Still October 17 in São Paulo.
test("dashboard presets use São Paulo days and an equally sized adjacent comparison", () => {
  const today = dashboardRange({ periodo: "hoje" }, now);
  assert.equal(today.start, "2026-10-17");
  assert.equal(today.end, "2026-10-17");
  assert.equal(today.previousStart, "2026-10-16");
  assert.equal(today.previousEnd, "2026-10-16");
  const week = dashboardRange({ periodo: "7" }, now);
  assert.equal(week.start, "2026-10-11");
  assert.equal(week.previousStart, "2026-10-04");
  assert.equal(week.previousEnd, "2026-10-10");
  assert.equal(week.days, 7);
  assert.equal(dashboardRange({}, now).days, 30);
  assert.equal(dashboardRange({ periodo: "90" }, now).days, 90);
});

test("custom dashboard ranges validate real calendar dates, maximum size and future dates", () => {
  const leap = dashboardRange(
    { periodo: "personalizado", inicio: "2024-02-28", fim: "2024-03-01" },
    now,
  );
  assert.equal(leap.days, 3);
  assert.equal(leap.previousStart, "2024-02-25");
  assert.equal(leap.previousEnd, "2024-02-27");
  assert.equal(leap.error, null);
  const ninety = dashboardRange(
    { periodo: "personalizado", inicio: "2026-07-20", fim: "2026-10-17" },
    now,
  );
  assert.equal(ninety.days, 90);
  assert.equal(ninety.error, null);
  for (const query of [
    { periodo: "personalizado", inicio: "2026-07-19", fim: "2026-10-17" },
    { periodo: "personalizado", inicio: "2026-02-30", fim: "2026-03-01" },
    { periodo: "personalizado", inicio: "2026-10-18", fim: "2026-10-18" },
    { periodo: "personalizado", inicio: "2026-10-17", fim: "2026-10-16" },
    { periodo: "personalizado", inicio: ["2026-10-17"], fim: "2026-10-17" },
    { periodo: "personalizado", inicio: "", fim: "" },
    { periodo: "https://example.invalid" },
    { periodo: ["7"] },
  ]) {
    const result = dashboardRange(query, now);
    assert.equal(result.period, "30");
    assert.equal(result.days, 30);
    assert.ok(result.error);
  }
});

test("growth never invents infinity or a percentage without a positive prior baseline", () => {
  assert.equal(dashboardGrowth(3, 2), 50);
  assert.equal(dashboardGrowth(2, 3), -33.3);
  assert.equal(dashboardGrowth(0, 4), -100);
  assert.equal(dashboardGrowth(4, 4), 0);
  for (const [current, previous] of [
    [0, 0],
    [4, 0],
    [4, -1],
    [-1, 4],
    [Infinity, 4],
    [4, NaN],
  ]) {
    assert.equal(dashboardGrowth(current, previous), null);
  }
});

test("chart intervals preserve every count and null personal customer scope", () => {
  const days: DashboardDay[] = Array.from({ length: 90 }, (_, index) => ({
    day: addDays("2026-07-20", index),
    appointments: index,
    completed: 1,
    canceled: 0,
    new_customers: index % 3,
  }));
  const buckets = dashboardBuckets(days);
  assert.ok(buckets.length <= 14);
  assert.equal(buckets[0].first, days[0].day);
  assert.equal(buckets.at(-1)?.last, days.at(-1)?.day);
  assert.equal(
    buckets.reduce((sum, item) => sum + item.appointments, 0),
    days.reduce((sum, day) => sum + day.appointments, 0),
  );
  assert.equal(
    buckets.reduce((sum, item) => sum + item.completed, 0),
    90,
  );
  assert.equal(
    buckets.reduce((sum, item) => sum + (item.new_customers ?? 0), 0),
    90,
  );
  assert.ok(
    dashboardBuckets(
      days.map((day) => ({ ...day, new_customers: null })),
    ).every((item) => item.new_customers === null),
  );
  assert.deepEqual(dashboardBuckets([]), []);
});
