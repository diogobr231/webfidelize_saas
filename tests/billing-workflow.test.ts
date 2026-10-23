import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BillingError,
  type MercadoPagoClient,
  type ProviderAuthorizedPayment,
  type ProviderPayment,
  type ProviderSubscription,
} from "../src/lib/billing/core";
import {
  BillingWorkflow,
  type BillingGateway,
} from "../src/lib/billing/workflow";
import type { CheckoutContext } from "../src/lib/billing/schema";
import {
  parseBillingWebhook,
  readBillingBody,
} from "../src/lib/billing/webhook";

const checkoutId = "11111111-1111-4111-8111-111111111111";
const otherCheckout = "22222222-2222-4222-8222-222222222222";
const companyId = "33333333-3333-4333-8333-333333333333";
const stamp = "2026-10-23T12:00:00.000Z";

function context(method: "pix" | "card" = "card"): CheckoutContext {
  return {
    id: checkoutId,
    company_id: companyId,
    plan_id: "essencial",
    method,
    amount_cents: 4990,
    currency: "BRL",
    environment: "test",
    external_reference: checkoutId,
    status: "pending",
    provider_id: method === "card" ? "subscription_a" : "987654",
    checkout_url: null,
    qr_code: null,
    qr_code_base64: null,
    expires_at: null,
    collector_id: "123456",
    payer_email: "billing-workflow@example.invalid",
  };
}
function subscription(): ProviderSubscription {
  return {
    id: "subscription_a",
    status: "authorized",
    amountCents: 4990,
    currency: "BRL",
    collectorId: "123456",
    externalReference: checkoutId,
    liveMode: false,
    checkoutUrl:
      "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=subscription_a",
    frequency: 1,
    frequencyType: "months",
    nextPaymentAt: "2026-11-23T12:00:00.000Z",
    updatedAt: stamp,
  };
}
function payment(method: "pix" | "card" = "card"): ProviderPayment {
  return {
    id: "987654",
    status: "approved",
    statusDetail: "accredited",
    amountCents: 4990,
    refundedCents: 0,
    currency: "BRL",
    collectorId: "123456",
    liveMode: false,
    externalReference: method === "pix" ? checkoutId : null,
    paymentMethodId: method === "pix" ? "pix" : "visa",
    approvedAt: stamp,
    updatedAt: stamp,
    expiresAt: null,
    qrCode: null,
    qrCodeBase64: null,
    ticketUrl: null,
  };
}
function invoice(): ProviderAuthorizedPayment {
  return {
    id: "765432",
    subscriptionId: "subscription_a",
    externalReference: checkoutId,
    amountCents: 4990,
    currency: "BRL",
    status: "processed",
    paymentId: "987654",
    debitAt: stamp,
    updatedAt: stamp,
  };
}

// Only the orchestration contract is tested here. The real ledger's RLS,
// concurrency and idempotency are exercised separately by test-billing-db.ts.
function harness(method: "pix" | "card" = "card") {
  const state = {
    contexts: new Map([[checkoutId, context(method)]]),
    ledger: new Map<string, string>(),
    payments: new Map([["987654", payment(method)]]),
    subscriptions: new Map([["subscription_a", subscription()]]),
    invoices: new Map([["765432", invoice()]]),
    searchResults: [] as ProviderAuthorizedPayment[],
    discovered: null as ProviderSubscription | null,
    discoveredPix: null as ProviderPayment | null,
    reads: [] as string[],
    writes: [] as { operation: string; payload: Record<string, unknown> }[],
  };
  function get<T>(map: Map<string, T>, key: string): T {
    const value = map.get(key);
    if (!value) throw new BillingError("unavailable");
    return structuredClone(value);
  }
  const provider: Pick<
    MercadoPagoClient,
    | "getPayment"
    | "getSubscription"
    | "getAuthorizedPayment"
    | "searchAuthorizedPayments"
    | "findSubscription"
    | "findPixPayment"
  > = {
    async getPayment(id) {
      state.reads.push(`payment:${id}`);
      return get(state.payments, id);
    },
    async getSubscription(id) {
      state.reads.push(`subscription:${id}`);
      return get(state.subscriptions, id);
    },
    async getAuthorizedPayment(id) {
      state.reads.push(`invoice:${id}`);
      return get(state.invoices, id);
    },
    async searchAuthorizedPayments(filters) {
      state.reads.push(`search:${filters.subscriptionId || filters.paymentId}`);
      return structuredClone(state.searchResults);
    },
    async findSubscription(id) {
      state.reads.push(`find:${id}`);
      return structuredClone(state.discovered);
    },
    async findPixPayment(id, amountCents) {
      state.reads.push(`find-pix:${id}:${amountCents}`);
      return structuredClone(state.discoveredPix);
    },
  };
  const gateway: BillingGateway = async (operation, payload) => {
    if (operation === "checkout_context")
      return state.contexts.get(String(payload.checkout_id)) ?? null;
    if (operation === "resource_context") {
      const checkout = state.ledger.get(String(payload.provider_id));
      return checkout ? (state.contexts.get(checkout) ?? null) : null;
    }
    state.writes.push({ operation, payload: structuredClone(payload) });
    return { applied: true };
  };
  return {
    state,
    workflow: new BillingWorkflow(
      provider as MercadoPagoClient,
      gateway,
      "test",
      "123456",
    ),
  };
}

test("lost Pix creation is recovered by reads and restores validated QR without another charge", async () => {
  const { state, workflow } = harness("pix");
  state.contexts.set(checkoutId, {
    ...context("pix"),
    status: "unknown",
    provider_id: null,
  });
  state.discoveredPix = {
    ...payment("pix"),
    status: "pending",
    approvedAt: null,
    qrCode: "SYNTHETIC-NOT-PAYABLE",
    expiresAt: "2026-10-24T12:00:00.000Z",
  };
  await workflow.checkout(checkoutId);
  assert.deepEqual(state.reads, [`find-pix:${checkoutId}:4990`]);
  assert.deepEqual(
    state.writes.map((entry) => entry.operation),
    ["checkout_created", "record_payment"],
  );
  assert.deepEqual(state.writes[0].payload, {
    checkout_id: checkoutId,
    provider_id: "987654",
    qr_code: "SYNTHETIC-NOT-PAYABLE",
    qr_code_base64: null,
    expires_at: "2026-10-24T12:00:00.000Z",
  });
  assert.equal(state.writes[1].payload.status, "pending");
});

test("unknown Pix absence leaves attempt unchanged; no match cannot authorize a new creation", async () => {
  const { state, workflow } = harness("pix");
  state.contexts.set(checkoutId, {
    ...context("pix"),
    status: "unknown",
    provider_id: null,
  });
  await workflow.checkout(checkoutId);
  assert.deepEqual(state.reads, [`find-pix:${checkoutId}:4990`]);
  assert.deepEqual(state.writes, []);
});

test("late Pix webhook or refresh restores QR but never overwrites terminal or mismatched checkout", async () => {
  const { state, workflow } = harness("pix");
  state.payments.set("987654", {
    ...payment("pix"),
    status: "pending",
    approvedAt: null,
    qrCode: "SYNTHETIC-NOT-PAYABLE",
  });
  await workflow.event("payment", "987654");
  assert.equal(state.writes[0].operation, "checkout_created");
  state.writes.length = 0;
  state.contexts.set(checkoutId, { ...context("pix"), status: "completed" });
  await workflow.checkout(checkoutId);
  assert.deepEqual(
    state.writes.map((entry) => entry.operation),
    ["record_payment"],
  );
  state.writes.length = 0;
  state.contexts.set(checkoutId, { ...context("pix"), provider_id: "123456" });
  await assert.rejects(
    workflow.recordPayment(
      state.payments.get("987654")!,
      state.contexts.get(checkoutId)!,
    ),
    BillingError,
  );
  assert.deepEqual(state.writes, []);
});

test("invalid recovered Pix never persists its QR or payment", async () => {
  for (const patch of [
    { amountCents: 8990 },
    { collectorId: "999999" },
    { liveMode: true },
    { externalReference: otherCheckout },
    { paymentMethodId: "visa" },
    { updatedAt: null },
  ]) {
    const { state, workflow } = harness("pix");
    state.contexts.set(checkoutId, {
      ...context("pix"),
      status: "unknown",
      provider_id: null,
    });
    state.discoveredPix = {
      ...payment("pix"),
      status: "pending",
      approvedAt: null,
      qrCode: "SYNTHETIC-NOT-PAYABLE",
      ...patch,
    };
    await assert.rejects(workflow.checkout(checkoutId), BillingError);
    assert.deepEqual(state.writes, []);
  }
});

test("billing workflow rejects a valid-looking context returned for another checkout", async () => {
  const { state, workflow } = harness();
  state.contexts.set(checkoutId, {
    ...context(),
    id: otherCheckout,
    external_reference: otherCheckout,
  });
  await assert.rejects(
    workflow.context(checkoutId),
    (error) => error instanceof BillingError && error.code === "mismatch",
  );
  assert.deepEqual(state.writes, []);
});

test("billing context separates absent resources from invalid account or environment", async () => {
  const { state, workflow } = harness();
  assert.equal(await workflow.context("not-a-checkout"), null);
  assert.equal(await workflow.context(otherCheckout), null);
  for (const patch of [
    { collector_id: "999999" },
    { environment: "live" as const },
  ]) {
    state.contexts.set(checkoutId, { ...context(), ...patch });
    await assert.rejects(workflow.context(checkoutId), BillingError);
  }
  assert.deepEqual(state.writes, []);
});

test("card authorization updates only the subscription, never creates a payment", async () => {
  const { state, workflow } = harness();
  await workflow.event("subscription_preapproval", "subscription_a");
  assert.deepEqual(
    state.writes.map((entry) => entry.operation),
    ["record_subscription"],
  );
  assert.equal(state.writes[0].payload.status, "authorized");
  assert.equal(state.writes[0].payload.environment, "test");
});

test("a card payment arriving first requires a refetched recurring invoice and subscription", async () => {
  const { state, workflow } = harness();
  state.searchResults = [invoice()];
  await workflow.event("payment", "987654");
  assert.deepEqual(state.reads, [
    "payment:987654",
    "search:987654",
    "invoice:765432",
    "subscription:subscription_a",
  ]);
  assert.deepEqual(
    state.writes.map((entry) => entry.operation),
    ["record_subscription", "record_payment"],
  );
  const saved = state.writes[1].payload;
  assert.equal(saved.external_reference, checkoutId);
  assert.equal(saved.subscription_id, "subscription_a");
  assert.equal(saved.authorized_payment_id, "765432");
  assert.equal(saved.status, "approved");
  assert.equal(saved.environment, "test");
});

test("a known checkout reference alone cannot attach a card payment without invoice proof", async () => {
  const { state, workflow } = harness();
  state.payments.set("987654", { ...payment(), externalReference: checkoutId });
  await workflow.event("payment", "987654");
  assert.deepEqual(state.writes, []);
  assert.ok(state.reads.includes("search:987654"));
});

test("unrelated payments and subscriptions do not mutate this platform's records", async () => {
  const { state, workflow } = harness();
  state.subscriptions.set("subscription_a", {
    ...subscription(),
    externalReference: otherCheckout,
  });
  await workflow.event("subscription_preapproval", "subscription_a");
  await workflow.event("payment", "987654");
  assert.deepEqual(state.writes, []);
});

test("duplicate matching invoice search results fail closed before recording money", async () => {
  const { state, workflow } = harness();
  state.searchResults = [invoice(), { ...invoice(), id: "765433" }];
  await assert.rejects(workflow.event("payment", "987654"), BillingError);
  assert.deepEqual(state.writes, []);
});

test("stored card payment is refetched and a partial refund revokes its paid status", async () => {
  const { state, workflow } = harness();
  state.ledger.set("987654", checkoutId);
  state.payments.set("987654", {
    ...payment(),
    refundedCents: 100,
    updatedAt: "2026-10-23T13:00:00.000Z",
  });
  await workflow.event("payment", "987654");
  assert.deepEqual(state.reads, ["payment:987654"]);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].payload.status, "refunded");
  assert.equal(
    state.writes[0].payload.last_modified,
    "2026-10-23T13:00:00.000Z",
  );
  assert.equal(state.writes[0].payload.subscription_id, "subscription_a");
});

test("pix reconciliation uses the persisted provider ID and forwards authoritative payment dates", async () => {
  const { state, workflow } = harness("pix");
  await workflow.checkout(checkoutId);
  assert.deepEqual(state.reads, ["payment:987654"]);
  assert.equal(state.writes[0].operation, "record_payment");
  assert.equal(state.writes[0].payload.method, "pix");
  assert.equal(state.writes[0].payload.approved_at, stamp);
  assert.equal(state.writes[0].payload.last_modified, stamp);
  assert.equal("subscription_id" in state.writes[0].payload, false);
});

test("an uncertain card creation with no provider match never attempts a second creation", async () => {
  const { state, workflow } = harness();
  state.contexts.set(checkoutId, {
    ...context(),
    status: "unknown",
    provider_id: null,
  });
  await workflow.checkout(checkoutId);
  assert.deepEqual(state.reads, [`find:${checkoutId}`]);
  assert.deepEqual(state.writes, []);
});

test("recovery of an uncertain card creation attaches the existing subscription then records it", async () => {
  const { state, workflow } = harness();
  state.contexts.set(checkoutId, {
    ...context(),
    status: "unknown",
    provider_id: null,
  });
  state.discovered = subscription();
  await workflow.checkout(checkoutId);
  assert.deepEqual(
    state.writes.map((entry) => entry.operation),
    ["checkout_created", "record_subscription"],
  );
  assert.equal(state.writes[0].payload.provider_id, "subscription_a");
  assert.equal(
    state.writes.some((entry) => entry.operation === "record_payment"),
    false,
  );
});

test("refetched invoice belonging to another subscription cannot approve the selected checkout", async () => {
  const { state, workflow } = harness();
  state.searchResults = [invoice()];
  state.invoices.set("765432", {
    ...invoice(),
    subscriptionId: "subscription_other",
  });
  await assert.rejects(workflow.checkout(checkoutId), BillingError);
  assert.equal(
    state.writes.some((entry) => entry.operation === "record_payment"),
    false,
  );
});

test("webhook body cannot substitute the signed resource and event dedup allows later updates", () => {
  const query = new URLSearchParams("data.id=987654&type=payment");
  const body = { type: "payment", data: { id: "987654" } };
  const event = parseBillingWebhook(body, query, "request-one");
  assert.deepEqual(parseBillingWebhook(body, query, "request-one"), event);
  assert.notEqual(
    parseBillingWebhook(body, query, "request-two").eventKey,
    event.eventKey,
  );
  assert.throws(
    () =>
      parseBillingWebhook(
        { ...body, data: { id: "765432" } },
        query,
        "request-one",
      ),
    BillingError,
  );
  assert.throws(
    () =>
      parseBillingWebhook(
        { ...body, type: "subscription_preapproval" },
        query,
        "request-one",
      ),
    BillingError,
  );
  assert.throws(
    () =>
      parseBillingWebhook(
        body,
        new URLSearchParams("data.id=987654&data.id=765432"),
        "request-one",
      ),
    BillingError,
  );
});

test("webhook streaming body rejects an oversized payload without relying on Content-Length", async () => {
  const oversized = new Request("https://fixture.example/webhook", {
    method: "POST",
    body: JSON.stringify({ pad: "x".repeat(32768) }),
  });
  await assert.rejects(readBillingBody(oversized), BillingError);
  const valid = new Request("https://fixture.example/webhook", {
    method: "POST",
    body: JSON.stringify({ type: "payment", data: { id: "987654" } }),
  });
  assert.deepEqual(await readBillingBody(valid), {
    type: "payment",
    data: { id: "987654" },
  });
});
