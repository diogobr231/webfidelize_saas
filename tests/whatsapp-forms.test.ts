import assert from "node:assert/strict";
import test from "node:test";
import { parseReminderSettings } from "../src/lib/whatsapp-forms";

function values(offsets: string[], limit: string | null = "100") {
  const form = new FormData();
  form.set("enabled", "on");
  if (limit !== null) form.set("monthly_limit", limit);
  offsets.forEach((offset) => form.append("offset_minutes", offset));
  return form;
}

test("reminder settings accept chosen offsets and a deliberate zero consumption limit", () => {
  const input = parseReminderSettings(values(["1440", "120", ""], "0"));
  assert.ok(input.success);
  assert.deepEqual(input.data, {
    enabled: true,
    offsets: [1440, 120],
    limit: 0,
  });
});

test("reminder settings reject duplicate, excessive, fractional and out-of-range offsets", () => {
  for (const offsets of [
    ["1440", "1440"],
    ["30", "60", "120", "240"],
    ["29"],
    ["10081"],
    ["30.5"],
    [""],
  ]) {
    assert.equal(
      parseReminderSettings(values(offsets)).success,
      false,
      offsets.join(","),
    );
  }
});

test("reminder settings do not silently turn missing or invalid caps into zero", () => {
  for (const cap of [null, "", "-1", "2.5", "100001", "abc"]) {
    assert.equal(
      parseReminderSettings(values(["1440"], cap)).success,
      false,
      String(cap),
    );
  }
});
