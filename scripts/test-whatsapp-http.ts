import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Production Next HTTP routes with an isolated local backend. No .env file is
// loaded by this test; its preload prevents external provider requests even if
// the build has an inlined Supabase origin. No real messages or database writes.
const companyId = "11111111-1111-4111-8111-111111111111";
const phoneNumberId = "123456789012345";
const appSecret = "isolated-whatsapp-app-secret-not-for-production";
const gatewaySecret = "isolated-whatsapp-gateway-secret-not-for-production";
const cronSecret = "isolated-whatsapp-cron-secret-not-for-production";
const verifyToken = "isolated-whatsapp-verify-token-not-for-production";
const confirmationToken = "ab".repeat(32);
const job = {
  job_id: "33333333-3333-4333-8333-333333333333",
  company_id: companyId,
  appointment_id: "44444444-4444-4444-8444-444444444444",
  starts_at: "2026-10-22T23:00:00.000Z",
  recipient: "5511999999999",
  customer_name: "Cliente QA",
  company_name: "Empresa QA",
  offset_minutes: 1440,
};
type RpcCall = { name: string; body: Record<string, unknown> };
let phase = "setup";
let checks = 0;

async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
const pass = (message: string) => {
  checks++;
  console.log(`PASS isolated WhatsApp: ${message}`);
};
function signature(body: string) {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}
function webhook(value: Record<string, unknown>, senderId = phoneNumberId) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1234567890",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: senderId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

async function main() {
  assert.ok(existsSync(".next/BUILD_ID"), "Build before isolated HTTP checks");
  const calls: RpcCall[] = [];
  let metaRequests = 0;
  let providerStatus = 200;
  let providerMalformed = false;
  let pending: (typeof job)[] = [];
  let failRpc = "";
  let confirmed = false;
  let optedOut = false;
  let confirmations = 0;
  const sentBodies: Record<string, unknown>[] = [];
  const backend = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      calls.push({ name, body });
      const allowedErrors = [
        null,
        undefined,
        "provider_rejected",
        "network_unknown",
        "worker_interrupted",
        "invalid_recipient",
        "not_eligible",
        "limit_reached",
        "delivery_failed",
      ];
      if (
        body.p_secret !== gatewaySecret ||
        name === failRpc ||
        !allowedErrors.includes(body.p_error)
      ) {
        res.statusCode = 500;
        res.end(JSON.stringify({ message: "Controlled fixture error" }));
        return;
      }
      let result: unknown = true;
      if (name === "claim_whatsapp_reminders") {
        result = pending;
        pending = [];
      }
      if (name === "prepare_whatsapp_reminder") result = job;
      if (name === "whatsapp_confirmation") {
        result = null;
        if (
          body.p_token_hash ===
          createHash("sha256").update(confirmationToken).digest("hex")
        ) {
          if (body.p_action === "confirm") {
            confirmed = true;
            confirmations++;
          }
          if (body.p_action === "optout") optedOut = true;
          result = {
            company_name: "Empresa QA",
            starts_at: job.starts_at,
            confirmed,
            opted_out: optedOut,
          };
        }
      }
      res.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === `/meta/v25.0/${phoneNumberId}/messages`) {
      metaRequests++;
      sentBodies.push(body);
      res.statusCode = providerStatus;
      res.end(
        JSON.stringify(
          providerMalformed
            ? {}
            : { messages: [{ id: "wamid.isolated.accepted" }] },
        ),
      );
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Unexpected isolated provider request" }));
  });
  await new Promise<void>((done) => backend.listen(0, "127.0.0.1", done));
  const backendOrigin = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve("tests/fixtures/whatsapp-fetch-hook.mjs")).href,
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(port),
      "-H",
      "127.0.0.1",
    ],
    {
      windowsHide: true,
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        APP_URL: "https://reminders.example.invalid",
        TEST_WHATSAPP_BACKEND_URL: backendOrigin,
        NEXT_PUBLIC_SUPABASE_URL: "https://fake.supabase.test",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-key",
        WHATSAPP_APP_SECRET: appSecret,
        WHATSAPP_GATEWAY_SECRET: gatewaySecret,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: verifyToken,
        WHATSAPP_GRAPH_VERSION: "v25.0",
        WHATSAPP_SEND_ENABLED: "true",
        CRON_SECRET: cronSecret,
        WHATSAPP_CONNECTIONS_JSON: JSON.stringify([
          {
            companyId,
            phoneNumberId,
            accessToken: "isolated-meta-access-token-never-sent-externally",
            templateName: "web_fidelize_lembrete",
            languageCode: "pt_BR",
          },
        ]),
      },
    },
  );
  // Drain streams. Never print token-bearing request paths, headers or provider
  // payloads in a failure report; test phase and source location are enough.
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  async function request(path: string, init: RequestInit = {}) {
    const target = new URL(path, base);
    assert.equal(target.origin, base);
    return fetch(target, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  }
  async function postWebhook(body: string, sig = signature(body)) {
    return request("/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body,
    });
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error("Isolated Next exited");
      try {
        await request("/api/whatsapp/webhook");
        ready = true;
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 250));
      }
    }
    assert.ok(ready, "Isolated Next failed to start");

    phase = "cron authentication";
    for (const method of ["GET", "POST"])
      for (const headers of [
        {},
        { Authorization: "Bearer wrong" },
      ] as HeadersInit[]) {
        const response = await request("/api/whatsapp/process", {
          method,
          headers,
        });
        assert.equal(response.status, 401);
      }
    assert.equal(calls.length, 0);
    assert.equal(metaRequests, 0);
    pass("unauthenticated cron GET/POST cannot query the queue or send");

    phase = "webhook subscription";
    const query = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": verifyToken,
      "hub.challenge": "1234567890",
    });
    const challenge = await request(`/api/whatsapp/webhook?${query}`);
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), "1234567890");
    query.set("hub.verify_token", "wrong");
    assert.equal((await request(`/api/whatsapp/webhook?${query}`)).status, 403);
    assert.equal(calls.length, 0);
    pass(
      "subscription requires the verification token and has no side effects",
    );

    phase = "webhook signature";
    const emptyEvent = JSON.stringify(webhook({}));
    for (const invalid of ["", "sha256=abc", signature(emptyEvent + " ")])
      assert.equal((await postWebhook(emptyEvent, invalid)).status, 403);
    assert.equal(calls.length, 0);
    pass("missing, malformed and body-mismatched signatures cannot reach data");

    phase = "verified webhook shape";
    assert.equal((await postWebhook("{malformed-json")).status, 400);
    assert.equal((await postWebhook(emptyEvent)).status, 200);
    const unknownEvent = JSON.stringify(
      webhook(
        {
          statuses: [
            {
              id: "wamid.isolated",
              status: "delivered",
              timestamp: String(Math.floor(Date.now() / 1000)),
              recipient_id: "5511999999999",
            },
          ],
        },
        "999999999999999",
      ),
    );
    assert.equal((await postWebhook(unknownEvent)).status, 200);
    assert.equal(calls.length, 0);
    pass(
      "signed malformed JSON rejected; unrelated senders cannot mutate tenants",
    );

    phase = "empty authenticated queue";
    const processed = await request("/api/whatsapp/process", {
      method: "POST",
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(processed.status, 200);
    assert.ok(calls.some((call) => call.name.includes("claim")));
    assert.equal(metaRequests, 0);
    pass("authenticated processing of an empty queue makes no provider send");

    phase = "outbound provider protocol";
    pending = [job];
    const accepted = await request("/api/whatsapp/process", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).accepted, 1);
    assert.equal(metaRequests, 1);
    const outbound = sentBodies[0];
    assert.equal(outbound.messaging_product, "whatsapp");
    assert.equal(outbound.type, "template");
    assert.equal(outbound.to, job.recipient);
    assert.equal(outbound.biz_opaque_callback_data, job.job_id);
    const template = outbound.template as {
      components: { parameters: { text: string }[] }[];
    };
    const rawToken = template.components[1].parameters[0].text;
    assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(calls).includes(rawToken), false);
    assert.equal(calls.at(-1)!.body.p_status, "accepted");
    const again = await request("/api/whatsapp/process", {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal((await again.json()).claimed, 0);
    assert.equal(metaRequests, 1);
    pass(
      "cron sends one approved-template request; accepted is not delivered; repeat does not resend",
    );

    phase = "provider rejection and uncertain outcome";
    for (const scenario of [
      {
        status: 400,
        malformed: false,
        outcome: "failed",
        error: "provider_rejected",
      },
      {
        status: 503,
        malformed: false,
        outcome: "unknown",
        error: "network_unknown",
      },
      {
        status: 200,
        malformed: true,
        outcome: "unknown",
        error: "network_unknown",
      },
    ]) {
      providerStatus = scenario.status;
      providerMalformed = scenario.malformed;
      pending = [job];
      const before: number = metaRequests;
      const response = await request("/api/whatsapp/process", {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json())[scenario.outcome], 1);
      assert.equal(metaRequests, before + 1);
      assert.equal(calls.at(-1)!.body.p_status, scenario.outcome);
      assert.equal(calls.at(-1)!.body.p_error, scenario.error);
    }
    pass(
      "provider failures and uncertain responses persist safe outcomes without automatic retry",
    );

    phase = "verified delivery and optout";
    const eventsStart = calls.length;
    const delivery = JSON.stringify(
      webhook({
        statuses: [
          {
            id: "wamid.isolated.accepted",
            status: "failed",
            biz_opaque_callback_data: job.job_id,
            errors: [{ code: 131026, message: "private provider details" }],
          },
        ],
        messages: [
          { type: "text", from: job.recipient, text: { body: "PARAR" } },
        ],
      }),
    );
    assert.equal((await postWebhook(delivery)).status, 200);
    assert.deepEqual(
      calls.slice(eventsStart).map((call) => call.name),
      ["whatsapp_delivery_event", "whatsapp_opt_out"],
    );
    assert.equal(calls[eventsStart].body.p_company, companyId);
    assert.equal(calls[eventsStart].body.p_job, job.job_id);
    assert.equal(calls[eventsStart].body.p_error, "delivery_failed");
    assert.equal(calls[eventsStart + 1].body.p_phone, job.recipient);
    assert.equal(
      JSON.stringify(calls).includes("private provider details"),
      false,
    );
    failRpc = "whatsapp_delivery_event";
    assert.equal((await postWebhook(delivery)).status, 503);
    failRpc = "";
    pass(
      "signed receipts and opt-out use sender-bound RPCs; database outage returns retryable failure",
    );

    phase = "oversized webhook";
    const oversized = JSON.stringify({ body: "x".repeat(262145) });
    const beforeOversized = calls.length;
    assert.equal((await postWebhook(oversized)).status, 413);
    assert.equal(calls.length, beforeOversized);
    pass("oversized webhook rejected before database processing");

    phase = "public confirmation read";
    const confirmationPath = `/confirmar/${confirmationToken}`;
    const confirmation = await request(confirmationPath);
    assert.equal(confirmation.status, 200);
    assert.match(confirmation.headers.get("cache-control") || "", /no-store/);
    assert.equal(confirmation.headers.get("referrer-policy"), "no-referrer");
    const html = await confirmation.text();
    assert.match(html, /Confirmar minha presença/);
    assert.equal(confirmations, 0);
    assert.equal(calls.at(-1)!.body.p_action, "view");
    const invalid = await request("/confirmar/invalid");
    assert.match(await invalid.text(), /não está mais disponível/);
    assert.equal(confirmations, 0);
    pass(
      "GET and preview read never confirm attendance; token page is private/no-referrer",
    );

    phase = "confirmation action and CSRF";
    const parseForm = (source: string, responseValue: string) => {
      const sourceForm = [...source.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
        .map((m) => m[0])
        .find((value) => value.includes(`value="${responseValue}"`));
      assert.ok(sourceForm);
      const data = new FormData();
      for (const match of sourceForm.matchAll(/<input\b[^>]*>/g)) {
        const attrs = Object.fromEntries(
          [...match[0].matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
            m[1],
            m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
          ]),
        );
        if (attrs.type === "hidden" && attrs.name)
          data.append(attrs.name, attrs.value || "");
      }
      assert.ok([...data.keys()].some((key) => key.startsWith("$ACTION_")));
      return data;
    };
    const form = parseForm(html, "confirm");
    const blocked = await request(confirmationPath, {
      method: "POST",
      body: form,
      headers: { Origin: "https://evil.example" },
    });
    assert.ok(blocked.status >= 400);
    assert.equal(confirmations, 0);
    const submit = await request(confirmationPath, {
      method: "POST",
      body: form,
      headers: { Origin: base },
    });
    assert.equal(submit.status, 303);
    assert.equal(confirmations, 1);
    const success = await request(confirmationPath);
    const successHtml = await success.text();
    assert.match(successHtml, /Presença confirmada/);
    const optoutForm = parseForm(successHtml, "optout");
    const optout = await request(confirmationPath, {
      method: "POST",
      body: optoutForm,
      headers: { Origin: base },
    });
    assert.equal(optout.status, 303);
    assert.equal(optedOut, true);
    assert.match(
      await (await request(confirmationPath)).text(),
      /não receberá novos lembretes/,
    );
    pass(
      "valid POST confirms then opts out; cross-origin POST is rejected without mutation",
    );

    console.log(
      `PASS isolated WhatsApp: ${checks} HTTP flow groups; no external request, real message or live data change.`,
    );
  } finally {
    child.kill();
    await new Promise<void>((done) => backend.close(() => done()));
  }
}

main().catch((error: unknown) => {
  console.error(
    `FAIL isolated WhatsApp at ${phase}; secrets and bodies omitted.`,
  );
  const location =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .find((line) => /test-whatsapp-http\.(?:ts|js):\d+/.test(line))
      : undefined;
  if (location) console.error(location.trim());
  process.exitCode = 1;
});
