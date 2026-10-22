import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseConnections,
  type WhatsAppConnection,
} from "../src/lib/whatsapp/core";
import {
  staffNotificationTemplate,
  staffJobSchema,
  type StaffJob,
} from "../src/lib/whatsapp/staff-core";
import { processStaffNotifications } from "../src/lib/whatsapp/staff-processor";
import type { ReminderRpc, SendResult } from "../src/lib/whatsapp/processor";

const company = "11111111-1111-4111-8111-111111111111";
const connection: WhatsAppConnection = {
  companyId: company,
  phoneNumberId: "123456789012345",
  accessToken: "fixture-token-no-real-sending",
  templateName: "customer_reminder",
  languageCode: "pt_BR",
  staffDailyTemplateName: "staff_daily",
  staffNewAppointmentTemplateName: "staff_new",
};
const appointment = {
  appointment_id: "22222222-2222-4222-8222-222222222222",
  starts_at: "2026-10-22T21:00:00Z",
  customer_name: "Gabriela DEMO",
  service_name: "Unha demonstrativa",
};
const job: StaffJob = {
  job_id: "33333333-3333-4333-8333-333333333333",
  kind: "daily",
  company_id: company,
  professional_id: "44444444-4444-4444-8444-444444444444",
  professional_name: "Daniela DEMO",
  company_name: "Espaço DEMO",
  recipient: "5511990000001",
  local_date: "2026-10-22",
  part_index: 1,
  part_count: 1,
  appointments: [appointment],
};
const secret = "isolated-test-secret-not-for-production";

test("staff templates use distinct approved names, São Paulo times and opaque per-part correlation", () => {
  assert.deepEqual(parseConnections(JSON.stringify([connection])), [
    connection,
  ]);
  const daily = staffNotificationTemplate(connection, job);
  assert.equal(daily.template.name, "staff_daily");
  assert.equal(daily.biz_opaque_callback_data, job.job_id);
  assert.equal(daily.to, job.recipient);
  assert.deepEqual(
    daily.template.components[0].parameters.map((p) => p.text),
    [
      "Daniela DEMO",
      "Espaço DEMO",
      "22/10/2026",
      "1/1",
      "▪ 18:00 — Gabriela DEMO · Unha demonstrativa",
    ],
  );
  const fresh = staffNotificationTemplate(connection, {
    ...job,
    kind: "new_appointment",
  });
  assert.deepEqual(
    fresh.template.components[0].parameters.map((p) => p.text),
    [
      "Daniela DEMO",
      "Espaço DEMO",
      "Gabriela DEMO",
      "Unha demonstrativa",
      "22/10/2026",
      "18:00",
    ],
  );
  assert.equal(fresh.template.name, "staff_new");
  assert.equal(JSON.stringify(daily).includes(connection.accessToken), false);
  assert.throws(
    () =>
      staffNotificationTemplate(
        { ...connection, companyId: appointment.appointment_id },
        job,
      ),
    /INVALID/,
  );
  assert.throws(
    () =>
      staffNotificationTemplate(
        { ...connection, staffDailyTemplateName: undefined },
        job,
      ),
    /INVALID/,
  );
});

test("daily pages preserve every bounded appointment, sanitize whitespace and fit the approved template", () => {
  const page = staffNotificationTemplate(connection, {
    ...job,
    professional_name: "D".repeat(120),
    company_name: "E".repeat(100),
    part_count: 144,
    appointments: [0, 1].map((_, i) => ({
      ...appointment,
      appointment_id: i ? job.professional_id : appointment.appointment_id,
      customer_name: "G".repeat(120),
      service_name: "S".repeat(120),
    })),
  });
  const values = page.template.components[0].parameters;
  assert.equal(values[3].text, "1/144");
  assert.equal(values[4].text.split("▪").length, 3);
  assert.ok(values.reduce((sum, p) => sum + p.text.length, 0) <= 820);
  const clean = staffNotificationTemplate(connection, {
    ...job,
    professional_name: "Daniela\n\t DEMO",
  });
  assert.equal(clean.template.components[0].parameters[0].text, "Daniela DEMO");
  for (const invalid of [
    { ...job, appointments: [] },
    { ...job, appointments: [appointment, appointment, appointment] },
    { ...job, kind: "new_appointment", part_count: 2 },
    { ...job, part_index: 2 },
    { ...job, recipient: "123" },
  ])
    assert.equal(staffJobSchema.safeParse(invalid).success, false);
});

function harness(
  options: {
    claimed?: unknown;
    prepared?: unknown;
    fail?: string;
    outcome?: SendResult;
    throwSend?: boolean;
    connections?: WhatsAppConnection[];
    finalized?: unknown;
  } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sends: StaffJob[] = [];
  const rpc: ReminderRpc = async (name, args) => {
    calls.push({ name, args });
    if (options.fail === name) return { data: null, error: true };
    if (name === "claim_whatsapp_staff_notifications")
      return {
        data: options.claimed === undefined ? [job] : options.claimed,
        error: null,
      };
    if (name === "prepare_whatsapp_staff_notification")
      return {
        data: options.prepared === undefined ? job : options.prepared,
        error: null,
      };
    return {
      data: Object.hasOwn(options, "finalized") ? options.finalized : true,
      error: null,
    };
  };
  return {
    calls,
    sends,
    run: () =>
      processStaffNotifications({
        secret,
        connections: options.connections ?? [connection],
        rpc,
        send: async (_connection, current) => {
          sends.push(current);
          if (options.throwSend) throw new Error("private provider detail");
          return (
            options.outcome ?? {
              status: "accepted",
              messageId: "wamid.staff.fixture",
            }
          );
        },
      }),
  };
}

test("staff worker prepares and reserves before sending and persists safe results once", async () => {
  const h = harness();
  const result = await h.run();
  assert.deepEqual(result, {
    claimed: 1,
    accepted: 1,
    failed: 0,
    unknown: 0,
    skipped: 0,
  });
  assert.equal(h.calls[0].args.p_batch, 2);
  assert.deepEqual(
    h.calls.map((c) => c.name),
    [
      "claim_whatsapp_staff_notifications",
      "prepare_whatsapp_staff_notification",
      "finish_whatsapp_staff_notification",
    ],
  );
  assert.equal(h.calls[2].args.p_message_id, "wamid.staff.fixture");
  assert.equal(h.sends.length, 1);
});

test("staff worker never consumes quota or uses the customer template when staff templates are missing", async () => {
  const h = harness({
    connections: [{ ...connection, staffDailyTemplateName: undefined }],
  });
  assert.equal((await h.run()).claimed, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.sends.length, 0);
});

test("staff worker skips invalidated appointments and foreign tenants without sending", async () => {
  const removed = harness({ prepared: null });
  assert.equal((await removed.run()).skipped, 1);
  assert.equal(removed.sends.length, 0);
  const foreign = harness({
    claimed: [{ ...job, company_id: appointment.appointment_id }],
  });
  assert.equal((await foreign.run()).skipped, 1);
  assert.equal(foreign.calls.length, 1);
  for (const changed of [
    { ...job, job_id: appointment.appointment_id },
    { ...job, company_id: appointment.appointment_id },
    { ...job, professional_id: appointment.appointment_id },
    { ...job, kind: "new_appointment" },
  ]) {
    const h = harness({ prepared: changed });
    await assert.rejects(h.run, /RESPONSE_INVALID/);
    assert.equal(h.sends.length, 0);
  }
});

test("staff worker never retries ambiguous delivery and never stores provider error details", async () => {
  const h = harness({ throwSend: true });
  assert.equal((await h.run()).unknown, 1);
  assert.equal(h.sends.length, 1);
  assert.equal(h.calls.at(-1)?.args.p_error, "network_unknown");
  assert.equal(
    JSON.stringify(h.calls).includes("private provider detail"),
    false,
  );
  const rejected = harness({
    outcome: { status: "failed", error: "provider_rejected" },
  });
  assert.equal((await rejected.run()).failed, 1);
});

test("staff worker fails closed on database errors, oversized claims or malformed jobs", async () => {
  for (const fail of [
    "claim_whatsapp_staff_notifications",
    "prepare_whatsapp_staff_notification",
    "finish_whatsapp_staff_notification",
  ]) {
    const h = harness({ fail });
    await assert.rejects(h.run, /DATABASE_UNAVAILABLE/);
    assert.equal(h.sends.length, fail.startsWith("finish") ? 1 : 0);
  }
  for (const claimed of [[{}], Array(6).fill(job), true]) {
    const h = harness({ claimed });
    await assert.rejects(h.run, /RESPONSE_INVALID/);
    assert.equal(h.sends.length, 0);
  }
});

test("staff worker stops without another send or success count when finalization is unconfirmed", async () => {
  const outcomes: SendResult[] = [
    { status: "accepted", messageId: "wamid.staff.fixture" },
    { status: "failed", error: "provider_rejected" },
    { status: "unknown", error: "network_unknown" },
  ];
  for (const finalized of [false, null, undefined, "true", { detail: secret }]) {
    for (const outcome of outcomes) {
      const h = harness({
        finalized,
        outcome,
        claimed: [
          job,
          { ...job, job_id: "55555555-5555-4555-8555-555555555555" },
        ],
      });
      await assert.rejects(h.run, {
        message: "WHATSAPP_DATABASE_RESPONSE_INVALID",
      });
      assert.equal(h.sends.length, 1);
      assert.deepEqual(
        h.calls.map((call) => call.name),
        [
          "claim_whatsapp_staff_notifications",
          "prepare_whatsapp_staff_notification",
          "finish_whatsapp_staff_notification",
        ],
      );
    }
  }
});
