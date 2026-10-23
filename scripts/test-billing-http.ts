import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import type { BillingCheckout } from "../src/lib/billing/types";
import {
  startBillingFixture,
  companyId,
  otherCompany,
  subscriptionId,
  paymentId,
  invoiceId,
  gatewaySecret,
  webhookSecret,
  providerToken,
  cronSecret,
  pixCode,
  pixImage,
} from "../tests/fixtures/billing-server";

// Real Next routes/actions with isolated Auth, REST and Mercado Pago transports.
// Provider secrets are overwritten with dummy values; the child preload denies
// all external fetches. SQL entitlement/RLS logic has its own database suite.
const route = `/painel/${companyId}/assinatura`;
let phase = "setup",
  checks = 0;
const pass = (name: string) => {
  checks++;
  console.log(`PASS isolated billing: ${name}`);
};
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attributes = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [
      match[1],
      decode(match[2]),
    ]),
  );
function formFrom(html: string, marker: string): FormData {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((form) => form.includes(marker));
  assert.ok(source, `Rendered form not found: ${marker}`);
  const body = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(match[0]);
    if (input.type === "hidden" && input.name)
      body.append(input.name, input.value || "");
  }
  assert.ok(
    [...body.keys()].some((name) => name.startsWith("$ACTION_")),
    "Real bound server action must be present",
  );
  return body;
}
function copyForm(source: FormData) {
  const result = new FormData();
  for (const [key, value] of source) result.append(key, value);
  return result;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
async function main() {
  assert.ok(
    existsSync(".next/BUILD_ID"),
    "Build the app before isolated billing checks",
  );
  // Only the public build origin is read, solely for matching cookie namespaces.
  const publicOrigin =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (existsSync(".env.local")
      ? readFileSync(".env.local", "utf8").match(
          /^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m,
        )?.[1]
      : undefined) ||
    "https://fake.supabase.test";
  const fixture = await startBillingFixture(new URL(publicOrigin).origin);
  const { state, reset, checkout, rpcCalls, providerCalls } = fixture;
  const currentCheckout = (): BillingCheckout | null => state.checkout;
  const browser = new Map<string, string>();
  const auth = createServerClient(publicOrigin, "isolated-publishable-key", {
    global: {
      fetch: (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        return fetch(
          new URL(url.pathname + url.search, fixture.auth.origin),
          init,
        );
      },
    },
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...browser].map(([name, value]) => ({ name, value })),
      setAll: (items) =>
        items.forEach(({ name, value }) => browser.set(name, value)),
    },
  });
  assert.equal(
    (await auth.auth.setSession(fixture.auth.session("password"))).error,
    null,
  );
  let child: ChildProcess | null = null,
    base = "",
    childLog = "";
  async function stop() {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise<void>((done) => child!.once("close", () => done()));
    }
    child = null;
  }
  async function start(mode: "test" | "live" | "disabled") {
    await stop();
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(resolve("tests/fixtures/billing-fetch-hook.mjs")).href,
        "node_modules/next/dist/bin/next",
        "start",
        "-p",
        String(port),
        "-H",
        "127.0.0.1",
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          APP_URL: "https://billing.example.invalid",
          AUTH_FLOW_SECRET: "isolated-billing-auth-secret-not-production",
          TEST_BILLING_BACKEND_URL: fixture.origin,
          NEXT_PUBLIC_SUPABASE_URL: publicOrigin,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "isolated-publishable-key",
          VERCEL_ENV: "preview",
          BILLING_MODE: mode,
          MERCADO_PAGO_ACCESS_TOKEN: providerToken,
          MERCADO_PAGO_TEST_ACCESS_TOKEN: providerToken,
          MERCADO_PAGO_COLLECTOR_ID: "123456",
          MERCADO_PAGO_WEBHOOK_SECRET: webhookSecret,
          BILLING_GATEWAY_SECRET: gatewaySecret,
          CRON_SECRET: cronSecret,
        },
      },
    );
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (chunk) => {
        childLog = (childLog + String(chunk)).slice(-20_000);
      });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(child.exitCode, null, "Isolated Next exited before startup");
      try {
        if (
          (await fetch(`${base}/entrar`, { signal: AbortSignal.timeout(1000) }))
            .status === 200
        ) {
          ready = true;
          break;
        }
      } catch {
        /* bounded local readiness */
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    assert.ok(ready, "Isolated Next did not become ready");
  }
  async function request(
    path: string,
    body?: FormData,
    authenticated = true,
    origin = base,
  ) {
    const target = new URL(path, base);
    assert.equal(target.origin, base);
    return fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "text/html",
        ...(authenticated
          ? {
              Cookie: [...browser]
                .map(([name, value]) => `${name}=${value}`)
                .join("; "),
            }
          : {}),
        ...(body ? { Origin: origin, Referer: target.toString() } : {}),
      },
    });
  }
  async function html(path = route) {
    const response = await request(path);
    assert.equal(response.status, 200);
    return response.text();
  }
  async function location(response: Response) {
    let target = response.headers.get("location");
    if (!target && response.status === 200) {
      const markup = await response.text();
      const meta = [...markup.matchAll(/<meta\b[^>]*>/g)]
        .map((match) => attributes(match[0]))
        .find((tag) => tag.id === "__next-page-redirect");
      target = meta?.content?.match(/^[01];url=(.*)$/)?.[1] || null;
    }
    assert.ok(target, `Expected redirect, HTTP ${response.status}`);
    return new URL(target, base);
  }
  const operations = (operation: string) =>
    rpcCalls.filter(
      (call) =>
        call.name === "billing_gateway" && call.body.p_operation === operation,
    );
  const writes = () => providerCalls.filter((call) => call.method !== "GET");
  async function webhook(
    topic = "payment",
    id = paymentId,
    options: {
      bodyId?: string;
      signature?: string;
      requestId?: string;
      extraQuery?: string;
      body?: string;
    } = {},
  ) {
    const requestId =
      options.requestId || `fixture-request-${checks}-${providerCalls.length}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const signature =
      options.signature ??
      `ts=${ts},v1=${createHmac("sha256", webhookSecret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
    return fetch(
      `${base}/api/webhooks/mercadopago?data.id=${encodeURIComponent(id)}&type=${topic}${options.extraQuery || ""}`,
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
          "x-request-id": requestId,
        },
        body:
          options.body ||
          JSON.stringify({ type: topic, data: { id: options.bodyId || id } }),
        signal: AbortSignal.timeout(30_000),
      },
    );
  }
  try {
    await start("test");
    phase = "access gates and server action authorization";
    assert.equal(
      (await location(await request(route, undefined, false))).pathname,
      "/entrar",
    );
    assert.equal(
      (await location(await request(`/painel/${otherCompany}/assinatura`)))
        .pathname,
      "/painel",
    );
    const initial = await html();
    assert.match(initial, /49,90/);
    assert.match(initial, /89,90/);
    assert.match(initial, /149,90/);
    assert.match(initial, /Ambiente de testes do Mercado Pago/);
    const pixForm = formFrom(initial, 'name="cpf"');
    pixForm.set("cpf", "12345678909");
    assert.equal(pixForm.get("quoted_amount_cents"), "4990");
    for (const role of ["MANAGER", "EMPLOYEE"]) {
      state.role = role;
      await request(route, copyForm(pixForm));
      assert.equal(
        writes().length,
        0,
        `${role} cannot reach financial provider mutation`,
      );
    }
    state.role = "OWNER";
    const crossCompany = copyForm(pixForm);
    crossCompany.set("company_id", otherCompany);
    await request(route, crossCompany);
    assert.equal(writes().length, 0);
    await request(route, copyForm(pixForm), false);
    assert.equal(writes().length, 0);
    const crossOrigin = await request(
      route,
      copyForm(pixForm),
      true,
      "https://untrusted.example.invalid",
    );
    assert.ok(
      crossOrigin.status >= 400,
      "Next server action must reject foreign Origin",
    );
    assert.equal(writes().length, 0);
    pass(
      "authenticated owner only; cross-company, manager, employee and anonymous submissions denied",
    );

    phase = "admin financial history authorization";
    reset();
    const diagnostics = `/admin/empresas/${companyId}`;
    for (const role of ["OWNER", "MANAGER", "EMPLOYEE"]) {
      state.role = role;
      const snapshots = rpcCalls.filter(
        (call) => call.name === "billing_snapshot",
      ).length;
      const denied = await request(diagnostics);
      const deniedHtml = await denied.text();
      // App Router may already have streamed the shell with HTTP 200 when an
      // awaited authorization read resolves to notFound(). Verify the actual
      // framework 404 boundary as well as absence of protected data access.
      assert.ok([200, 404].includes(denied.status));
      if (denied.status === 200)
        assert.match(deniedHtml, /NEXT_HTTP_ERROR_FALLBACK;404/);
      assert.ok(!deniedHtml.includes('id="company-billing-title"'));
      assert.equal(
        rpcCalls.filter((call) => call.name === "billing_snapshot").length,
        snapshots,
      );
      assert.equal(
        rpcCalls.filter((call) => call.name === "admin_company_diagnostics")
          .length,
        0,
      );
    }
    state.isAdmin = true;
    state.payments = [
      {
        provider_id: paymentId,
        environment: "test",
        amount_cents: 4990,
        status: "refunded",
        method: "pix",
        approved_at: new Date().toISOString(),
      },
    ];
    const adminHtml = await html(diagnostics);
    assert.match(adminHtml, /Assinatura e pagamentos/);
    assert.match(adminHtml, /Estornado/);
    assert.match(adminHtml, /49,90/);
    assert.match(adminHtml, /Consulta administrativa/);
    assert.equal(providerCalls.length, 0);
    pass(
      "admin financial history requires SUPER_ADMIN before ledger read; client roles reach not-found boundary without payment query",
    );

    phase = "test history remains identified after live configuration";
    reset();
    state.environment = "live";
    state.payments = [
      {
        provider_id: paymentId,
        environment: "test",
        status: "approved",
        amount_cents: 4990,
        method: "pix",
        approved_at: new Date().toISOString(),
      },
    ];
    state.subscription = {
      provider_id: subscriptionId,
      environment: "test",
      status: "authorized",
      plan_id: "essencial",
      next_payment_at: null,
    };
    const retainedTestHtml = await html();
    assert.match(retainedTestHtml, /Teste · sem cobrança real/);
    assert.doesNotMatch(retainedTestHtml, /Cancelar renovação automática/);
    assert.match(retainedTestHtml, /Alterações bloqueadas/);
    assert.doesNotMatch(retainedTestHtml, /Ambiente de testes do Mercado Pago/);
    assert.equal(state.paidUntil, null);
    assert.equal(providerCalls.length, 0);
    state.isAdmin = true;
    const adminTestHtml = await html(diagnostics);
    assert.match(adminTestHtml, /Teste · sem cobrança real/);
    assert.match(adminTestHtml, /Sem período de acesso vigente/);
    assert.equal(providerCalls.length, 0);
    pass(
      "historical test payments stay labeled in company and admin views after live configuration, without real paid access",
    );

    phase = "future paid deadline with refunded gap";
    reset();
    state.companyStatus = "active";
    state.paidUntil = new Date(Date.now() + 86_400_000).toISOString();
    state.access = false;
    const gapHtml = await html();
    assert.match(gapHtml, /Alterações bloqueadas/);
    assert.match(gapHtml, /o acesso precisa ser conferido/);
    assert.ok(!gapHtml.includes('name="cpf"'));
    assert.ok(
      rpcCalls.some(
        (call) =>
          call.name === "company_access_state" &&
          call.body.p_company_id === companyId,
      ),
    );
    assert.equal(providerCalls.length, 0);
    pass(
      "future paid deadline cannot display operational access or purchase form during refunded entitlement gap",
    );

    phase = "trial, disabled and invalid input";
    reset();
    state.trial = true;
    state.companyStatus = "trialing";
    assert.match(await html(), /Aproveite seus 7 dias grátis, sem cartão/);
    await request(route, copyForm(pixForm));
    assert.equal(writes().length, 0);
    assert.equal(state.checkout, null);
    reset();
    state.enabled = false;
    assert.match(await html(), /contratação online ainda não está habilitada/);
    await request(route, copyForm(pixForm));
    assert.equal(writes().length, 0);
    reset();
    state.demo = true;
    await request(route, copyForm(pixForm));
    assert.equal(writes().length, 0);
    reset();
    const badCpf = copyForm(pixForm);
    badCpf.set("cpf", "11111111111");
    await request(route, badCpf);
    assert.equal(writes().length, 0);
    assert.equal(state.checkout, null);
    const duplicate = copyForm(pixForm);
    duplicate.append("company_id", otherCompany);
    await request(route, duplicate);
    assert.equal(writes().length, 0);
    const badQuote = copyForm(pixForm);
    badQuote.set("quoted_amount_cents", "1");
    await request(route, badQuote);
    assert.equal(writes().length, 0);
    pass(
      "active trial, disabled configuration, demo company, malformed input and tampered quote never charge",
    );

    phase = "return query is untrusted";
    reset();
    const fakeReturn = await html(
      `${route}?status=approved&collection_status=approved&payment_id=${paymentId}&preapproval_id=${subscriptionId}`,
    );
    assert.match(fakeReturn, /Alterações bloqueadas/);
    assert.match(fakeReturn, /Ainda não há pagamentos registrados/);
    assert.equal(providerCalls.length, 0);
    assert.equal(operations("record_payment").length, 0);
    pass(
      "approved URL parameters cannot activate a plan or impersonate backend payment confirmation",
    );

    phase = "Pix creation and display";
    reset();
    const pixResponse = await request(route, copyForm(pixForm));
    assert.equal(pixResponse.status, 200);
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].path, "/v1/payments");
    assert.equal(writes()[0].body.transaction_amount, 49.9);
    assert.equal(
      Object.hasOwn(writes()[0].body, "date_of_expiration"),
      false,
      "Use provider's documented 24h default, without a moving minimum-window timestamp",
    );
    assert.equal(writes()[0].idempotency, currentCheckout()?.id);
    assert.equal(currentCheckout()?.qr_code, pixCode);
    assert.equal(currentCheckout()?.qr_code_base64, pixImage);
    const pixPage = await html();
    assert.match(pixPage, new RegExp(pixCode));
    assert.ok(pixPage.includes("data:image/png;base64,"));
    assert.doesNotMatch(pixPage, /12345678909|TEST-isolated-billing-token/);
    assert.equal(
      operations("record_payment").at(-1)?.body.p_payload &&
        (
          operations("record_payment").at(-1)!.body.p_payload as Record<
            string,
            unknown
          >
        ).status,
      "pending",
    );
    await request(route, copyForm(pixForm));
    assert.equal(writes().length, 1);
    pass(
      "Pix amount comes from server quote, QR renders, pending access stays blocked and repeated submission reuses attempt",
    );

    phase = "webhook authenticity";
    const before = providerCalls.length,
      beforeEvents = operations("record_event").length;
    assert.equal(
      (await webhook("payment", paymentId, { signature: "invalid" })).status,
      401,
    );
    assert.equal(
      (await webhook("payment", paymentId, { bodyId: "123" })).status,
      400,
    );
    assert.equal(
      (await webhook("payment", paymentId, { extraQuery: "&data.id=123" }))
        .status,
      401,
    );
    assert.equal(
      (await webhook("payment", paymentId, { body: "{" })).status,
      400,
    );
    assert.equal(providerCalls.length, before);
    assert.equal(operations("record_event").length, beforeEvents);
    pass(
      "invalid HMAC, duplicate query ID, body substitution and malformed JSON rejected before reconciliation",
    );

    phase = "payment reconciliation and duplicate notification";
    state.paymentStatus = "approved";
    assert.equal(
      (
        await webhook("payment", paymentId, {
          requestId: "fixture-approved-pix",
        })
      ).status,
      200,
    );
    const settled = operations("record_payment").at(-1)!.body
      .p_payload as Record<string, unknown>;
    assert.equal(settled.status, "approved");
    assert.equal(settled.amount_cents, 4990);
    assert.equal(settled.environment, "test");
    const after = providerCalls.length;
    assert.equal(
      (
        await webhook("payment", paymentId, {
          requestId: "fixture-approved-pix",
        })
      ).status,
      200,
    );
    assert.equal(
      providerCalls.length,
      after,
      "Completed inbox event must not repeat provider calls",
    );
    assert.equal(state.paidUntil, null);
    assert.equal(state.access, false);
    pass(
      "valid notification refetches actual payment; event replay is idempotent and test result never shows paid access",
    );

    phase = "provider mismatch fails closed";
    for (const patch of [
      { collector_id: 999 },
      { live_mode: true },
      { transaction_amount: 0.01 },
      { external_reference: "other-checkout" },
    ]) {
      const records = operations("record_payment").length;
      state.paymentPatch = patch;
      assert.equal((await webhook("payment", paymentId)).status, 503);
      assert.equal(operations("record_payment").length, records);
    }
    state.paymentPatch = {};
    pass(
      "collector, environment, amount and checkout reference mismatch cannot be recorded as a paid company",
    );

    phase = "unknown card creation is never blindly retried";
    reset();
    state.checkout = checkout("card", "pending");
    state.checkout.provider_id = subscriptionId;
    state.checkout.checkout_url = `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${subscriptionId}`;
    const cardForm = formFrom(await html(), "Continuar no Mercado Pago");
    reset();
    state.cardFailure = true;
    const firstCard = await request(route, copyForm(cardForm));
    assert.equal(firstCard.status, 200);
    assert.equal(state.checkout?.status, "unknown");
    assert.equal(writes().length, 1);
    await request(route, copyForm(cardForm));
    assert.equal(writes().length, 1);
    assert.ok(
      providerCalls.some((call) => call.path === "/preapproval/search"),
    );
    pass(
      "ambiguous hosted card creation is saved as unknown and retried action only searches existing subscription",
    );

    phase = "hosted card checkout";
    reset();
    const destination = await location(
      await request(route, copyForm(cardForm)),
    );
    assert.equal(destination.origin, "https://www.mercadopago.com.br");
    assert.equal(
      destination.searchParams.get("preapproval_id"),
      subscriptionId,
    );
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].body.status, "pending");
    assert.equal(operations("record_payment").length, 0);
    assert.equal(state.access, false);
    pass(
      "card redirect is official hosted checkout, pending authorization does not activate subscription access",
    );

    phase = "recurring card payment requires authoritative invoice";
    state.subscriptionStatus = "authorized";
    state.paymentStatus = "approved";
    assert.equal(
      (await webhook("subscription_preapproval", subscriptionId)).status,
      200,
    );
    assert.equal(operations("record_payment").length, 0);
    assert.equal((await webhook("payment", paymentId)).status, 200);
    assert.equal(
      operations("record_payment").length,
      0,
      "Unlinked card payment cannot be applied merely by external reference",
    );
    state.invoiceAvailable = true;
    assert.equal(
      (await webhook("subscription_authorized_payment", invoiceId)).status,
      200,
    );
    const cardPayment = operations("record_payment").at(-1)!.body
      .p_payload as Record<string, unknown>;
    assert.equal(cardPayment.authorized_payment_id, invoiceId);
    assert.equal(cardPayment.subscription_id, subscriptionId);
    assert.ok(
      providerCalls.some((call) => call.path === `/v1/payments/${paymentId}`),
    );
    pass(
      "card authorization alone grants nothing; verified invoice and fetched payment are required together",
    );

    phase = "cancel and cron authorization";
    const beforeCancelHtml = await html();
    const cancelForm = formFrom(
      beforeCancelHtml,
      "Cancelar renovação automática",
    );
    const refreshForm = formFrom(beforeCancelHtml, "Verificar pagamento");
    const putsBefore = providerCalls.filter(
      (call) => call.method === "PUT",
    ).length;
    await request(route, copyForm(cancelForm));
    assert.equal(
      providerCalls.filter((call) => call.method === "PUT").length,
      putsBefore,
    );
    cancelForm.set("confirm_action", "yes");
    await request(route, cancelForm);
    assert.equal(state.subscriptionStatus, "cancelled");
    assert.equal((await fetch(`${base}/api/billing/reconcile`)).status, 401);
    const cron = await fetch(`${base}/api/billing/reconcile`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(cron.status, 200);
    pass(
      "cancellation requires explicit confirmation and cron rejects unauthenticated requests",
    );

    phase = "live credentials never operate on old test resources";
    reset();
    state.checkout = checkout("card", "unknown");
    state.checkout.provider_id = subscriptionId;
    state.checkout.checkout_url = `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${subscriptionId}`;
    state.subscription = {
      provider_id: subscriptionId,
      environment: "test",
      status: "authorized",
      plan_id: "essencial",
      next_payment_at: null,
    };
    state.payments = [
      {
        provider_id: paymentId,
        environment: "test",
        status: "approved",
        amount_cents: 4990,
        method: "card",
        approved_at: new Date().toISOString(),
      },
    ];
    state.environment = "live";
    // Defend against stale/malformed RPC output too, beyond the SQL mode filter.
    state.staleSnapshot = true;
    await start("live");
    const liveHtml = await html();
    assert.match(liveHtml, /Teste · sem cobrança real/);
    assert.ok(
      liveHtml.includes('name="cpf"'),
      "Historical test contract must not block a new live purchase",
    );
    assert.doesNotMatch(
      liveHtml,
      /Cancelar renovação automática|Continuar no Mercado Pago/,
    );
    await request(route, copyForm(refreshForm));
    await request(route, copyForm(cancelForm));
    assert.equal(
      providerCalls.length,
      0,
      "Live credentials cannot query or cancel test contract/payment IDs",
    );
    state.staleSnapshot = false;
    const livePixForm = formFrom(liveHtml, 'name="cpf"');
    livePixForm.set("cpf", "12345678909");
    await request(route, livePixForm);
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].path, "/v1/payments");
    assert.equal(currentCheckout()?.environment, "live");
    assert.equal(state.paidUntil, null);
    pass(
      "switching to live preserves labeled test history, blocks old form actions and permits a fresh isolated live-mode checkout",
    );

    phase = "globally disabled mode";
    reset();
    await start("disabled");
    assert.match(await html(), /contratação online ainda não está habilitada/);
    await request(route, copyForm(pixForm));
    assert.equal(providerCalls.length, 0);
    assert.equal((await webhook()).status, 503);
    const disabledCron = await fetch(`${base}/api/billing/reconcile`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.deepEqual(await disabledCron.json(), { enabled: false });
    assert.equal(providerCalls.length, 0);
    pass(
      "BILLING_MODE=disabled disables actions, webhook and cron regardless of database flag",
    );
    assert.deepEqual(
      fixture.unexpected,
      [],
      "All isolated service requests must be explicitly covered",
    );
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/billing-http.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          groups: checks,
          externalFinancialCalls: 0,
          result: "passed",
        },
        null,
        2,
      ),
    );
    console.log(
      `Billing HTTP: ${checks} groups passed; only local synthetic services contacted.`,
    );
  } catch (error) {
    console.error(`Billing HTTP failed during: ${phase}`);
    // Only dummy credentials exist in this child. Keep diagnostic output bounded.
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/billing-http-child.log",
      childLog
        .replaceAll(providerToken, "[fixture-token]")
        .replaceAll(gatewaySecret, "[fixture-secret]")
        .replaceAll(webhookSecret, "[fixture-secret]"),
    );
    throw error;
  } finally {
    await stop();
    await fixture.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
