import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMyStaffWhatsAppPreference,
  parseReminderSettings,
  parseStaffReminderSettings,
  reminderOffsetLabel,
} from "../src/lib/whatsapp-forms";

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

test("reminder offsets use familiar units, including non-round legacy values", () => {
  assert.equal(reminderOffsetLabel(30), "30 min antes");
  assert.equal(reminderOffsetLabel(60), "1 hora antes");
  assert.equal(reminderOffsetLabel(120), "2 horas antes");
  assert.equal(reminderOffsetLabel(90), "1 hora e 30 min antes");
  assert.equal(reminderOffsetLabel(1400), "23 horas e 20 min antes");
  assert.equal(reminderOffsetLabel(1440), "1 dia antes");
  assert.equal(reminderOffsetLabel(2880), "2 dias antes");
  assert.equal(reminderOffsetLabel(1500), "1 dia e 1 hora antes");
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

test("staff settings preserve separate daily and new appointment choices with a strict local time", () => {
  const form = new FormData();
  form.set("staff_daily_enabled", "on");
  form.set("staff_daily_time", "08:00");
  const result = parseStaffReminderSettings(form);
  assert.ok(result.success);
  assert.deepEqual(result.data, {
    dailyEnabled: true,
    dailyTime: "08:00",
    newAppointmentEnabled: false,
  });
  form.set("staff_new_appointment_enabled", "on");
  form.delete("staff_daily_enabled");
  const next = parseStaffReminderSettings(form);
  assert.ok(next.success);
  assert.equal(next.data.dailyEnabled, false);
  assert.equal(next.data.newAppointmentEnabled, true);
  for (const time of [
    "",
    "8:00",
    "24:00",
    "08:60",
    "08:00:30",
    "08:00Z",
    "-1:00",
  ]) {
    form.set("staff_daily_time", time);
    assert.equal(parseStaffReminderSettings(form).success, false, time);
  }
});

test("staff opt-in requires affirmative self-consent and normalizes Brazilian phone input", () => {
  const form = new FormData();
  form.set("enabled", "yes");
  form.set("phone", "(11) 99999-8888");
  assert.equal(parseMyStaffWhatsAppPreference(form).success, false);
  form.set("attestation", "on");
  assert.deepEqual(parseMyStaffWhatsAppPreference(form), {
    success: true,
    data: { enabled: true, phone: "5511999998888" },
  });
  form.set("phone", "+55 (11) 99999-8888");
  assert.equal(parseMyStaffWhatsAppPreference(form).success, true);
  for (const phone of [
    "",
    "123",
    "00 99999-8888",
    "(10) 99999-8888",
    "+55 (20) 99999-8888",
    "abc11999998888",
    "+1 202 555 0101",
    "551199999888899",
  ]) {
    form.set("phone", phone);
    assert.equal(parseMyStaffWhatsAppPreference(form).success, false, phone);
  }
});

test("staff opt-out requires no phone or consent checkbox and ignores forged recipient identifiers", () => {
  const form = new FormData();
  form.set("enabled", "no");
  form.set("user_id", "someone-else");
  form.set("professional_id", "someone-else");
  assert.deepEqual(parseMyStaffWhatsAppPreference(form), {
    success: true,
    data: { enabled: false, phone: null },
  });
  for (const enabled of ["", "on", "true", "false"]) {
    form.set("enabled", enabled);
    assert.equal(parseMyStaffWhatsAppPreference(form).success, false, enabled);
  }
});
