import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  BillingError,
  MercadoPagoClient,
  isSettledPayment,
  moneyToCents,
  normalizeCpf,
  safeProviderId,
  safeProviderUrl,
  validatePaymentForCheckout,
  validateSubscriptionForCheckout,
  verifyWebhookSignature,
  type BillingConfig,
} from "../src/lib/billing/core";

const checkoutId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "abcd0123456789";
const config: BillingConfig = {
  accessToken: "TEST-private-fixture-token",
  collectorId: "123456",
  mode: "test",
};
const expected = {
  checkoutId,
  amountCents: 4990,
  collectorId: config.collectorId,
  mode: config.mode,
};
const approvedAt = "2026-10-23T10:00:00.000Z";
function payment(patch: Record<string, unknown> = {}) {
  return {
    id: 987654,
    collector_id: 123456,
    live_mode: false,
    external_reference: checkoutId,
    currency_id: "BRL",
    transaction_amount: 49.9,
    transaction_amount_refunded: 0,
    status: "pending",
    status_detail: "pending_waiting_transfer",
    payment_method_id: "pix",
    date_approved: null,
    date_last_updated: approvedAt,
    ...patch,
  };
}
function subscription(patch: Record<string, unknown> = {}) {
  return {
    id: subscriptionId,
    collector_id: 123456,
    external_reference: checkoutId,
    status: "pending",
    init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${subscriptionId}`,
    auto_recurring: {
      transaction_amount: 49.9,
      currency_id: "BRL",
      frequency: 1,
      frequency_type: "months",
    },
    ...patch,
  };
}
function fakeProvider(result: unknown, status = 200) {
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
    headers: Headers;
    redirect: RequestRedirect | undefined;
    cache: RequestCache | undefined;
  }[] = [];
  const client = new MercadoPagoClient(config, (async (input, options) => {
    calls.push({
      url: String(input),
      method: options?.method || "GET",
      body: options?.body ? JSON.parse(String(options.body)) : null,
      headers: new Headers(options?.headers),
      redirect: options?.redirect,
      cache: options?.cache,
    });
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch);
  return { client, calls };
}
const pixInput = {
  checkoutId,
  amountCents: 4990,
  email: "owner@example.invalid",
  cpf: "123.456.789-09",
  description: "Web Fidelize — Essencial",
  notificationUrl:
    "https://webfidelize-saas.vercel.app/api/webhooks/mercadopago",
};
const cardInput = {
  checkoutId,
  amountCents: 4990,
  email: "owner@example.invalid",
  description: "Web Fidelize — Essencial",
  backUrl: "https://webfidelize-saas.vercel.app/painel/assinatura",
};

test("Pix provider-default expiration avoids minimum-window failures and keeps retries identical", async () => {
  const { client, calls } = fakeProvider(payment());
  await client.createPix(pixInput);
  await client.createPix(pixInput);
  assert.equal(Object.hasOwn(calls[0].body!, "date_of_expiration"), false);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(
    calls[0].headers.get("X-Idempotency-Key"),
    calls[1].headers.get("X-Idempotency-Key"),
  );
});

test("billing converts exact cents and rejects fractional or malformed money", () => {
  for (const [value, cents] of [
    [49.9, 4990],
    [89.9, 8990],
    [149.9, 14990],
    ["49.90", 4990],
    ["0.01", 1],
    [0, 0],
  ] as const)
    assert.equal(moneyToCents(value), cents);
  for (const value of [
    -1,
    NaN,
    Infinity,
    0.001,
    "49,90",
    "1e2",
    "1.999",
    "",
    {},
    Number.MAX_SAFE_INTEGER,
  ])
    assert.throws(() => moneyToCents(value), BillingError);
});
test("billing validates CPF check digits without retaining customer identity", () => {
  assert.equal(normalizeCpf("123.456.789-09"), "12345678909");
  for (const value of [
    "11111111111",
    "00000000000",
    "12345678900",
    "1234567890",
    "abc12345678909",
  ])
    assert.throws(() => normalizeCpf(value), BillingError);
});
test("billing rejects unsafe resource paths and hosted checkout URLs", () => {
  assert.equal(safeProviderId(subscriptionId), subscriptionId);
  for (const value of [
    "../users/me",
    "a?x=1",
    "a%2fb",
    "a/b",
    "",
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => safeProviderId(value), BillingError);
  assert.ok(safeProviderUrl(subscription().init_point, "subscription"));
  for (const value of [
    "https://www.mercadopago.com.br.evil.example/subscriptions/checkout",
    "https://www.mercadopago.com.br@evil.example/subscriptions/checkout",
    "http://www.mercadopago.com.br/subscriptions/checkout",
    "https://www.mercadopago.com.br/login",
    "https://www.mercadopago.com.br/subscriptions/checkout#token",
  ])
    assert.throws(() => safeProviderUrl(value, "subscription"), BillingError);
});
test("Pix uses integer-price snapshot, stable idempotency key and one provider request", async () => {
  const { client, calls } = fakeProvider(payment());
  const result = await client.createPix(pixInput);
  assert.equal(result.amountCents, 4990);
  assert.equal(result.status, "pending");
  assert.equal(isSettledPayment(result), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.mercadopago.com/v1/payments");
  assert.equal(calls[0].headers.get("X-Idempotency-Key"), checkoutId);
  assert.equal(calls[0].body?.external_reference, checkoutId);
  assert.equal(calls[0].body?.transaction_amount, 49.9);
  assert.deepEqual(calls[0].body?.payer, {
    email: pixInput.email,
    identification: { type: "CPF", number: "12345678909" },
  });
  assert.equal(calls[0].redirect, "error");
  assert.equal(calls[0].cache, "no-store");
  assert.equal(JSON.stringify(result).includes("12345678909"), false);
  assert.equal(JSON.stringify(result).includes(pixInput.email), false);
});
test("Pix rejects invalid CPF/amount/reference/URLs before contacting provider", async () => {
  const { client, calls } = fakeProvider(payment());
  for (const patch of [
    { cpf: "12345678900" },
    { amountCents: 49.9 },
    { amountCents: 0 },
    { checkoutId: "client-price" },
    { notificationUrl: "http://localhost/webhook" },
    { email: "not-an-email" },
  ])
    await assert.rejects(
      client.createPix({ ...pixInput, ...patch }),
      BillingError,
    );
  assert.equal(calls.length, 0);
});
test("hosted card subscription stays pending and never resets or adds a trial", async () => {
  const { client, calls } = fakeProvider(subscription());
  const result = await client.createCardSubscription(cardInput);
  assert.equal(result.status, "pending");
  assert.equal(result.checkoutUrl, subscription().init_point);
  assert.equal(
    result.liveMode,
    null,
    "Subscription API does not guarantee live_mode; actual payment must verify it",
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body?.auto_recurring, {
    frequency: 1,
    frequency_type: "months",
    transaction_amount: 49.9,
    currency_id: "BRL",
  });
  assert.equal(calls[0].body?.status, "pending");
  assert.equal(calls[0].body?.card_token_id, undefined);
  assert.equal(
    calls[0].headers.get("X-Idempotency-Key"),
    null,
    "Do not imply an undocumented preapproval idempotency guarantee",
  );
});
test("provider verifies collector, currency, live mode and returned resource id", async () => {
  for (const patch of [
    { collector_id: 999 },
    { currency_id: "USD" },
    { live_mode: true },
    { live_mode: undefined },
    { id: 4321 },
    { transaction_amount: "49.901" },
  ])
    await assert.rejects(
      fakeProvider(payment(patch)).client.getPayment("987654"),
      BillingError,
    );
  for (const patch of [
    { collector_id: 999 },
    { id: "another-id" },
    { live_mode: true },
    {
      init_point:
        "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=another",
    },
  ])
    await assert.rejects(
      fakeProvider(subscription(patch)).client.getSubscription(subscriptionId),
      BillingError,
    );
});
test("checkout matching prevents amount, company reference and mode substitution", async () => {
  const p = await fakeProvider(payment()).client.getPayment("987654");
  const s =
    await fakeProvider(subscription()).client.getSubscription(subscriptionId);
  assert.equal(validatePaymentForCheckout(p, expected, "pix"), p);
  assert.equal(validateSubscriptionForCheckout(s, expected), s);
  for (const patch of [
    { amountCents: 1 },
    { checkoutId: "22222222-2222-4222-8222-222222222222" },
    { collectorId: "999" },
  ]) {
    assert.throws(
      () => validatePaymentForCheckout(p, { ...expected, ...patch }),
      BillingError,
    );
    assert.throws(
      () => validateSubscriptionForCheckout(s, { ...expected, ...patch }),
      BillingError,
    );
  }
  assert.throws(
    () => validatePaymentForCheckout(p, { ...expected, mode: "live" }),
    BillingError,
  );
});
test("only an approved, dated, unrefunded payment can settle an invoice", async () => {
  for (const status of [
    "pending",
    "authorized",
    "in_process",
    "rejected",
    "cancelled",
    "refunded",
    "charged_back",
  ]) {
    const p = await fakeProvider(
      payment({ status, date_approved: approvedAt }),
    ).client.getPayment("987654");
    assert.equal(isSettledPayment(p), false);
  }
  assert.equal(
    isSettledPayment(
      await fakeProvider(
        payment({ status: "approved", date_approved: approvedAt }),
      ).client.getPayment("987654"),
    ),
    true,
  );
  assert.equal(
    isSettledPayment(
      await fakeProvider(payment({ status: "approved" })).client.getPayment(
        "987654",
      ),
    ),
    false,
  );
  assert.equal(
    isSettledPayment(
      await fakeProvider(
        payment({
          status: "approved",
          date_approved: approvedAt,
          transaction_amount_refunded: 1,
        }),
      ).client.getPayment("987654"),
    ),
    false,
  );
});
test("subscription invoice only supplies links; actual payment still requires authoritative GET", async () => {
  const invoice = await fakeProvider({
    id: 112233,
    preapproval_id: subscriptionId,
    external_reference: checkoutId,
    currency_id: "BRL",
    transaction_amount: "49.90",
    status: "processed",
    payment: { id: 987654, status: "approved" },
    debit_date: approvedAt,
  }).client.getAuthorizedPayment("112233");
  assert.equal(invoice.paymentId, "987654");
  assert.equal(invoice.subscriptionId, subscriptionId);
  assert.equal(Object.hasOwn(invoice, "paid"), false);
  assert.equal(Object.hasOwn(invoice, "paymentStatus"), false);
});
test("cancel subscription validates provider acknowledgement without retry", async () => {
  const { client, calls } = fakeProvider(subscription({ status: "canceled" }));
  assert.equal(
    (await client.cancelSubscription(subscriptionId)).status,
    "cancelled",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(calls[0].body, { status: "canceled" });
});

test("subscription cancellation normalizes API and legacy statuses for reconciliation", async () => {
  for (const status of ["canceled", "cancelled"]) {
    const { client, calls } = fakeProvider(subscription({ status }));
    const result = await client.getSubscription(subscriptionId);
    assert.equal(result.status, "cancelled");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].body, null);
  }
  for (const status of ["pending", "authorized", "paused"]) {
    const { client } = fakeProvider(subscription({ status }));
    assert.equal((await client.getSubscription(subscriptionId)).status, status);
  }
});

test("cancellation requires a matching terminal acknowledgement and never retries ambiguity", async () => {
  for (const patch of [
    { status: "authorized" },
    { status: "pending" },
    { status: "canceled", id: "another-subscription", init_point: null },
  ]) {
    const { client, calls } = fakeProvider(subscription(patch));
    await assert.rejects(
      client.cancelSubscription(subscriptionId),
      (error: unknown) =>
        error instanceof BillingError && error.outcome === "unknown",
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { status: "canceled" });
  }
});

test("invoice search is bounded, read-only and rejects invoices outside requested filters", async () => {
  const invoice = {
    id: 112233,
    preapproval_id: subscriptionId,
    external_reference: checkoutId,
    currency_id: "BRL",
    transaction_amount: 49.9,
    status: "processed",
    payment: { id: 987654 },
    debit_date: approvedAt,
  };
  const { client, calls } = fakeProvider({
    results: [invoice],
    paging: { total: 1, offset: 0, limit: 20 },
  });
  assert.equal(
    (
      await client.searchAuthorizedPayments({
        subscriptionId,
        paymentId: "987654",
      })
    )[0].id,
    "112233",
  );
  const query = new URL(calls[0].url).searchParams;
  assert.equal(calls[0].method, "GET");
  assert.equal(query.get("preapproval_id"), subscriptionId);
  assert.equal(query.get("payment_id"), "987654");
  assert.equal(query.get("limit"), "20");
  await assert.rejects(client.searchAuthorizedPayments({}), BillingError);
  await assert.rejects(
    client.searchAuthorizedPayments({
      subscriptionId: "x?preapproval_id=another",
    }),
    BillingError,
  );
  for (const patch of [
    { preapproval_id: "another" },
    { payment: { id: 123 } },
    { currency_id: "USD" },
  ]) {
    await assert.rejects(
      fakeProvider({
        results: [{ ...invoice, ...patch }],
      }).client.searchAuthorizedPayments({
        subscriptionId,
        paymentId: "987654",
      }),
      BillingError,
    );
  }
  await assert.rejects(
    fakeProvider({
      results: [invoice, invoice],
    }).client.searchAuthorizedPayments({ subscriptionId }),
    BillingError,
  );
  await assert.rejects(
    fakeProvider({
      results: Array.from({ length: 21 }, () => invoice),
    }).client.searchAuthorizedPayments({ subscriptionId }),
    BillingError,
  );
});

test("recovering an uncertain subscription requires exact reference and complete unique results", async () => {
  const results = [
    subscription({ external_reference: "other-checkout" }),
    subscription(),
  ];
  const { client, calls } = fakeProvider({
    results,
    paging: { total: 2, offset: 0, limit: 20 },
  });
  assert.equal(
    (await client.findSubscription(checkoutId, cardInput.email))?.id,
    subscriptionId,
  );
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get("payer_email"), cardInput.email);
  assert.equal(query.get("limit"), "20");
  assert.equal(calls[0].method, "GET");
  assert.equal(
    await fakeProvider({
      results: [],
      paging: { total: 0, offset: 0 },
    }).client.findSubscription(checkoutId, cardInput.email),
    null,
  );
  await assert.rejects(
    fakeProvider({
      results: [subscription(), subscription()],
      paging: { total: 2, offset: 0 },
    }).client.findSubscription(checkoutId, cardInput.email),
    (error: unknown) =>
      error instanceof BillingError && error.code === "mismatch",
  );
  await assert.rejects(
    fakeProvider({
      results: [],
      paging: { total: 25, offset: 0 },
    }).client.findSubscription(checkoutId, cardInput.email),
    (error: unknown) =>
      error instanceof BillingError && error.code === "unavailable",
  );
  await assert.rejects(
    client.findSubscription(checkoutId, "a\nb@example.com"),
    BillingError,
  );
  await assert.rejects(
    client.findSubscription("unsafe?ref", cardInput.email),
    BillingError,
  );
});

test("invoice recovery reads both page ends and returns recent unique invoices regardless of API order", async () => {
  for (const descending of [false, true]) {
    const invoices = Array.from({ length: 21 }, (_, index) => ({
      id: 1000 + index,
      preapproval_id: subscriptionId,
      currency_id: "BRL",
      transaction_amount: 49.9,
      status: "processed",
      payment: { id: 2000 + index },
      debit_date: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      last_modified: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    if (descending) invoices.reverse();
    const offsets: number[] = [];
    const client = new MercadoPagoClient(config, (async (input) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      offsets.push(offset);
      return Response.json({
        results: invoices.slice(offset, offset + 20),
        paging: { total: 21, offset, limit: 20 },
      });
    }) as typeof fetch);
    const results = await client.searchAuthorizedPayments({ subscriptionId });
    assert.deepEqual(offsets, [0, 1]);
    assert.equal(results.length, 20);
    assert.equal(new Set(results.map((row) => row.id)).size, 20);
    assert.equal(results[0].id, "1020");
    assert.equal(results.at(-1)!.id, "1001");
  }
  await assert.rejects(
    fakeProvider({
      results: [],
      paging: { total: 21, offset: 0 },
    }).client.searchAuthorizedPayments({ subscriptionId }),
    BillingError,
  );
});
test("unknown outcomes are explicit and no card mutation is automatically retried", async () => {
  let calls = 0;
  const provider = new MercadoPagoClient(config, (async () => {
    calls++;
    throw new Error("secret-provider-token-and-cpf");
  }) as typeof fetch);
  await assert.rejects(
    provider.createCardSubscription(cardInput),
    (error: unknown) => {
      assert.ok(error instanceof BillingError);
      assert.equal(error.outcome, "unknown");
      assert.doesNotMatch(
        JSON.stringify(error) + error.message,
        /secret-provider|cpf/,
      );
      return true;
    },
  );
  assert.equal(calls, 1);
  for (const status of [408, 429, 500, 503])
    await assert.rejects(
      fakeProvider(
        { secret: "must-not-surface" },
        status,
      ).client.createCardSubscription(cardInput),
      (error: unknown) =>
        error instanceof BillingError &&
        error.outcome === "unknown" &&
        !error.message.includes("must-not-surface"),
    );
  await assert.rejects(
    fakeProvider(
      { secret: "must-not-surface" },
      400,
    ).client.createCardSubscription(cardInput),
    (error: unknown) =>
      error instanceof BillingError && error.outcome === "known",
  );
  await assert.rejects(
    fakeProvider(
      subscription({ init_point: "https://evil.example" }),
    ).client.createCardSubscription(cardInput),
    (error: unknown) =>
      error instanceof BillingError && error.outcome === "unknown",
  );
});
test("malformed JSON or redirect fails closed without leaking provider response", async () => {
  for (const response of [
    new Response("private error", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
    new Response("private error", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ]) {
    const client = new MercadoPagoClient(
      config,
      (async () => response) as typeof fetch,
    );
    await assert.rejects(
      client.createCardSubscription(cardInput),
      (error: unknown) =>
        error instanceof BillingError &&
        error.outcome === "unknown" &&
        !error.message.includes("private error"),
    );
  }
});
test("webhook HMAC accepts seconds and milliseconds and binds URL id/request id/raw timestamp", () => {
  const nowMs = 1792749600000,
    secret = "webhook-secret-fixture-123",
    requestId = "request-fixture-123",
    dataId = "ABcd0123";
  for (const ts of [String(nowMs / 1000), String(nowMs)]) {
    const signature = `ts=${ts},v1=${createHmac("sha256", secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex")}`;
    const input = { signature, requestId, dataId, secret, nowMs };
    assert.equal(verifyWebhookSignature(input), true);
    for (const patch of [
      { dataId: "different" },
      { requestId: "other" },
      { secret: "wrong-secret-fixture" },
      { signature: signature + ",ts=" + ts },
      { signature: signature.replace("v1=", "v2=") },
      { signature: null },
      { dataId: null },
      { requestId: null },
      { nowMs: nowMs + 600001 },
      { nowMs: nowMs - 60001 },
    ])
      assert.equal(verifyWebhookSignature({ ...input, ...patch }), false);
  }
});
test("invalid configuration and unsafe GET ids never issue requests", async () => {
  assert.throws(
    () => new MercadoPagoClient({ ...config, mode: "disabled" as never }),
    BillingError,
  );
  assert.throws(
    () => new MercadoPagoClient({ ...config, accessToken: "short" }),
    BillingError,
  );
  const { client, calls } = fakeProvider({});
  await assert.rejects(client.getPayment("123/../../users/me"), BillingError);
  await assert.rejects(
    client.getSubscription("a?status=authorized"),
    BillingError,
  );
  assert.equal(calls.length, 0);
});
