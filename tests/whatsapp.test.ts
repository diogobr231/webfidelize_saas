import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  equalSecret,
  parseConnections,
  parseWebhookEvents,
  readBoundedBody,
  reminderTemplate,
  tokenHash,
  verifyWhatsAppSignature,
  type ReminderJob,
  type WhatsAppConnection,
} from "../src/lib/whatsapp/core";
import {
  processReminders,
  type ReminderRpc,
  type SendResult,
} from "../src/lib/whatsapp/processor";

const companyA = "11111111-1111-4111-8111-111111111111";
const companyB = "22222222-2222-4222-8222-222222222222";
const connection: WhatsAppConnection = {
  companyId: companyA,
  phoneNumberId: "123456789012345",
  accessToken: "isolated-provider-token-not-real",
  templateName: "web_fidelize_lembrete",
  languageCode: "pt_BR",
};
const connectionB: WhatsAppConnection = {
  ...connection,
  companyId: companyB,
  phoneNumberId: "987654321012345",
};
const job: ReminderJob = {
  job_id: "33333333-3333-4333-8333-333333333333",
  company_id: companyA,
  appointment_id: "44444444-4444-4444-8444-444444444444",
  starts_at: "2026-10-22T23:00:00.000Z",
  recipient: "5511999999999",
  customer_name: "Cliente QA",
  company_name: "Empresa QA",
  offset_minutes: 1440,
};
const secret = "isolated-gateway-secret-not-for-production";
const token = "ab".repeat(32);

test("WhatsApp server connections reject ambiguity, unknown fields and invalid credentials without leaking inputs", () => {
  assert.deepEqual(parseConnections(undefined), []);
  assert.deepEqual(
    parseConnections(JSON.stringify([connection, connectionB])),
    [connection, connectionB],
  );
  const invalid = [
    "{not-json",
    JSON.stringify([connection, connection]),
    JSON.stringify([
      connection,
      { ...connectionB, phoneNumberId: connection.phoneNumberId },
    ]),
    JSON.stringify([{ ...connection, companyId: "user-supplied-tenant" }]),
    JSON.stringify([{ ...connection, accessToken: "short" }]),
    JSON.stringify([{ ...connection, languageCode: "whatever" }]),
    JSON.stringify([{ ...connection, url: "https://evil.example" }]),
    JSON.stringify([{ ...connection, phoneNumberId: "../messages" }]),
    JSON.stringify([{ ...connection, templateName: "../other" }]),
  ];
  for (const value of invalid)
    assert.throws(() => parseConnections(value), {
      message: "WHATSAPP_CONFIGURATION_INVALID",
    });
});

test("WhatsApp signature authenticates exact raw bytes, including Unicode and whitespace", () => {
  const raw = Buffer.from('{ "message":"Olá, João!" }\n');
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyWhatsAppSignature(raw, signature, secret), true);
  assert.equal(
    verifyWhatsAppSignature(
      Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),
      signature,
      secret,
    ),
    false,
  );
  for (const value of [
    null,
    "",
    "sha256=abc",
    "sha1=" + "a".repeat(64),
    "sha256=" + "g".repeat(64),
    signature + "x",
  ])
    assert.equal(verifyWhatsAppSignature(raw, value, secret), false);
  assert.equal(verifyWhatsAppSignature(raw, signature, "short"), false);
  assert.equal(verifyWhatsAppSignature(raw, signature, undefined), false);
  assert.equal(
    verifyWhatsAppSignature(raw, signature, secret + "other"),
    false,
  );
});

test("secret comparisons reject missing, short and oversized values without timing exceptions", () => {
  assert.equal(equalSecret(secret, secret), true);
  assert.equal(equalSecret(secret + "x", secret), false);
  for (const value of [null, "", "x".repeat(4097)])
    assert.equal(equalSecret(value, secret), false);
  assert.equal(equalSecret("short", "short"), false);
  assert.equal(equalSecret(secret, undefined), false);
});

test("reminder template uses approved name, Brasília time, a token-only URL suffix and opaque job correlation", () => {
  const message = reminderTemplate(
    connection,
    { ...job, customer_name: "Cliente\n QA" },
    token,
  );
  assert.equal(message.type, "template");
  assert.equal(message.to, job.recipient);
  assert.equal(message.biz_opaque_callback_data, job.job_id);
  assert.equal(message.template.name, connection.templateName);
  assert.deepEqual(message.template.components[0].parameters, [
    { type: "text", text: "Cliente QA" },
    { type: "text", text: "Empresa QA" },
    { type: "text", text: "22/10/2026" },
    { type: "text", text: "20:00" },
  ]);
  assert.deepEqual(message.template.components[1], {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: token }],
  });
  assert.equal(JSON.stringify(message).includes(connection.accessToken), false);
  assert.throws(
    () => reminderTemplate(connectionB, job, token),
    /WHATSAPP_JOB_INVALID/,
  );
  assert.throws(
    () => reminderTemplate(connection, job, "https://evil.example"),
    /WHATSAPP_JOB_INVALID/,
  );
});

function webhook(
  value: Record<string, unknown>,
  phoneNumberId = connection.phoneNumberId,
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: { metadata: { phone_number_id: phoneNumberId }, ...value },
          },
        ],
      },
    ],
  };
}

test("webhook events bind tenants to configured Meta sender, not callback input", () => {
  const payload = webhook({
    statuses: [
      {
        id: "wamid.test",
        status: "delivered",
        biz_opaque_callback_data: job.job_id,
        companyId: companyB,
        recipient_id: job.recipient,
      },
    ],
  });
  assert.deepEqual(parseWebhookEvents(payload, [connection, connectionB]), [
    {
      type: "delivery",
      companyId: companyA,
      jobId: job.job_id,
      messageId: "wamid.test",
      status: "delivered",
      error: null,
    },
  ]);
  assert.deepEqual(parseWebhookEvents(payload, [connectionB]), []);
  assert.deepEqual(
    parseWebhookEvents(webhook({ statuses: [] }, "unregistered"), [connection]),
    [],
  );
  assert.deepEqual(
    parseWebhookEvents({ ...payload, object: "page" }, [connection]),
    [],
  );
});

test("webhook parser only emits bounded delivery fields and a safe failure category", () => {
  const events = parseWebhookEvents(
    webhook({
      statuses: [
        {
          id: "wamid.failed",
          status: "failed",
          biz_opaque_callback_data: "not-uuid",
          errors: [{ code: 131026, message: "recipient PII and credentials" }],
        },
        { id: "x".repeat(257), status: "read" },
        { id: "wamid.unknown", status: "active" },
      ],
    }),
    [connection],
  );
  assert.deepEqual(events, [
    {
      type: "delivery",
      companyId: companyA,
      jobId: null,
      messageId: "wamid.failed",
      status: "failed",
      error: "delivery_failed",
    },
  ]);
  assert.equal(JSON.stringify(events).includes("credentials"), false);
  for (const malformed of [null, 1, [], {}, { entry: [null, {}] }])
    assert.deepEqual(parseWebhookEvents(malformed, [connection]), []);
});

test("only explicit opt-out commands create suppression events for that sender's tenant", () => {
  const events = parseWebhookEvents(
    webhook(
      {
        messages: [
          ...[" PARAR ", "sair", "STOP", "cancelar lembretes"].map((body) => ({
            type: "text",
            from: job.recipient,
            text: { body },
          })),
          {
            type: "text",
            from: job.recipient,
            text: { body: "Pode parar às 20h?" },
          },
          { type: "text", from: "wrong-number", text: { body: "parar" } },
          { type: "image", from: job.recipient, text: { body: "parar" } },
        ],
      },
      connectionB.phoneNumberId,
    ),
    [connection, connectionB],
  );
  assert.equal(events.length, 4);
  for (const event of events)
    assert.deepEqual(event, {
      type: "optout",
      companyId: companyB,
      phone: job.recipient,
    });
});

test("webhook rejects oversized normalized batches and streaming bodies even without Content-Length", async () => {
  assert.throws(
    () =>
      parseWebhookEvents(
        webhook({
          statuses: Array.from({ length: 1001 }, () => ({
            id: "wamid",
            status: "read",
          })),
        }),
        [connection],
      ),
    /WHATSAPP_PAYLOAD_TOO_LARGE/,
  );
  const good = new Request("https://example.invalid", {
    method: "POST",
    body: "Olá",
  });
  assert.deepEqual(
    Buffer.from(await readBoundedBody(good, 4)),
    Buffer.from("Olá"),
  );
  await assert.rejects(
    readBoundedBody(
      new Request("https://example.invalid", { method: "POST", body: "12345" }),
      4,
    ),
    /BODY_TOO_LARGE/,
  );
  await assert.rejects(
    readBoundedBody(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { "Content-Length": "50" },
        body: "1",
      }),
      4,
    ),
    /BODY_TOO_LARGE/,
  );
});

function runner(
  options: {
    claimed?: unknown;
    prepared?: unknown;
    sendResult?: SendResult;
    sendThrows?: boolean;
    errorAt?: string;
    finalized?: unknown;
  } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sent: {
    connection: WhatsAppConnection;
    job: ReminderJob;
    token: string;
  }[] = [];
  const rpc: ReminderRpc = async (name, args) => {
    calls.push({ name, args });
    if (name === options.errorAt) return { data: null, error: true };
    if (name === "claim_whatsapp_reminders")
      return { data: options.claimed ?? [job], error: null };
    if (name === "prepare_whatsapp_reminder")
      return {
        data: Object.hasOwn(options, "prepared") ? options.prepared : job,
        error: null,
      };
    return {
      data: Object.hasOwn(options, "finalized") ? options.finalized : true,
      error: null,
    };
  };
  const execute = () =>
    processReminders({
      secret,
      connections: [connection],
      rpc,
      send: async (value, current, confirmationToken) => {
        sent.push({
          connection: value,
          job: current,
          token: confirmationToken,
        });
        if (options.sendThrows) throw new Error("uncertain transport");
        return (
          options.sendResult ?? {
            status: "accepted",
            messageId: "wamid.accepted",
          }
        );
      },
    });
  return { calls, sent, execute };
}

test("worker persists only a token hash before sending and distinguishes acceptance from delivery", async () => {
  const r = runner();
  assert.deepEqual(await r.execute(), {
    claimed: 1,
    accepted: 1,
    failed: 0,
    unknown: 0,
    skipped: 0,
  });
  assert.deepEqual(
    r.calls.map((call) => call.name),
    [
      "claim_whatsapp_reminders",
      "prepare_whatsapp_reminder",
      "finish_whatsapp_reminder",
    ],
  );
  assert.equal(r.calls[0].args.p_batch, 5);
  assert.deepEqual(r.calls[0].args.p_companies, [companyA]);
  assert.match(r.sent[0].token, /^[a-f0-9]{64}$/);
  assert.equal(r.calls[1].args.p_token_hash, tokenHash(r.sent[0].token));
  assert.equal(JSON.stringify(r.calls).includes(r.sent[0].token), false);
  assert.equal(r.calls[2].args.p_status, "accepted");
  assert.equal(r.calls[2].args.p_message_id, "wamid.accepted");
});

test("worker rechecks current job before sending; canceled or opted-out jobs skip", async () => {
  const canceled = runner({ prepared: null });
  assert.equal((await canceled.execute()).skipped, 1);
  assert.equal(canceled.sent.length, 0);
  assert.equal(canceled.calls.length, 2);
  const changed = runner({
    prepared: {
      ...job,
      recipient: "5521999999999",
      starts_at: "2026-10-23T23:00:00Z",
    },
  });
  await changed.execute();
  assert.equal(changed.sent[0].job.recipient, "5521999999999");
  assert.equal(changed.sent[0].job.starts_at, "2026-10-23T23:00:00Z");
});

test("worker never sends a claimed job using another tenant's connection", async () => {
  const unexpected = runner({ claimed: [{ ...job, company_id: companyB }] });
  assert.equal((await unexpected.execute()).skipped, 1);
  assert.equal(unexpected.sent.length, 0);
  assert.equal(unexpected.calls.length, 1);
  for (const patch of [
    { company_id: companyB },
    { job_id: "55555555-5555-4555-8555-555555555555" },
  ]) {
    const invalid = runner({ prepared: { ...job, ...patch } });
    await assert.rejects(
      invalid.execute(),
      /WHATSAPP_DATABASE_RESPONSE_INVALID/,
    );
    assert.equal(invalid.sent.length, 0);
  }
});

test("worker treats ambiguous network outcomes as unknown and never retries within invocation", async () => {
  const r = runner({ sendThrows: true });
  assert.equal((await r.execute()).unknown, 1);
  assert.equal(r.sent.length, 1);
  const finish = r.calls.at(-1)!;
  assert.equal(finish.args.p_status, "unknown");
  assert.equal(finish.args.p_message_id, null);
  assert.equal(finish.args.p_error, "network_unknown");
});

test("worker retains provider rejection as failed and empty queue has no side effects", async () => {
  const rejected = runner({
    sendResult: { status: "failed", error: "provider_rejected" },
  });
  assert.equal((await rejected.execute()).failed, 1);
  assert.equal(rejected.sent.length, 1);
  assert.equal(rejected.calls.at(-1)!.args.p_error, "provider_rejected");
  const empty = runner({ claimed: [] });
  assert.equal((await empty.execute()).claimed, 0);
  assert.equal(empty.sent.length, 0);
  assert.equal(empty.calls.length, 1);
});

test("worker stops on database failures without resending or accepting unbounded jobs", async () => {
  for (const errorAt of [
    "claim_whatsapp_reminders",
    "prepare_whatsapp_reminder",
    "finish_whatsapp_reminder",
  ]) {
    const r = runner({ errorAt });
    await assert.rejects(r.execute(), /WHATSAPP_DATABASE_UNAVAILABLE/);
    assert.equal(r.sent.length, errorAt === "finish_whatsapp_reminder" ? 1 : 0);
  }
  for (const claimed of [
    {},
    Array.from({ length: 6 }, () => job),
    [{ ...job, recipient: "invalid" }],
  ]) {
    const invalid = runner({ claimed });
    await assert.rejects(
      invalid.execute(),
      /WHATSAPP_DATABASE_RESPONSE_INVALID/,
    );
    assert.equal(invalid.sent.length, 0);
  }
});

test("worker stops the batch when finalization is not confirmed and never retries the send", async () => {
  const outcomes: SendResult[] = [
    { status: "accepted", messageId: "wamid.accepted" },
    { status: "failed", error: "provider_rejected" },
    { status: "unknown", error: "network_unknown" },
  ];
  for (const finalized of [false, null, undefined, "true", { detail: secret }]) {
    for (const sendResult of outcomes) {
      const r = runner({
        finalized,
        sendResult,
        claimed: [
          job,
          { ...job, job_id: "55555555-5555-4555-8555-555555555555" },
        ],
      });
      await assert.rejects(r.execute(), {
        message: "WHATSAPP_DATABASE_RESPONSE_INVALID",
      });
      assert.equal(r.sent.length, 1);
      assert.deepEqual(
        r.calls.map((call) => call.name),
        [
          "claim_whatsapp_reminders",
          "prepare_whatsapp_reminder",
          "finish_whatsapp_reminder",
        ],
      );
    }
  }
});
