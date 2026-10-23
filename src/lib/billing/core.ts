import { createHmac, timingSafeEqual } from "node:crypto";

export type BillingMode = "test" | "live";
export type BillingConfig = {
  accessToken: string;
  collectorId: string;
  mode: BillingMode;
  timeoutMs?: number;
};
export type BillingErrorCode =
  | "invalid_input"
  | "not_configured"
  | "unavailable"
  | "rejected"
  | "invalid_response"
  | "mismatch";
/** Safe to log: never retains request data, credentials or provider response bodies. */
export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    public readonly outcome: "known" | "unknown" = "known",
    public readonly status?: number,
  ) {
    super(`Mercado Pago: ${code}`);
    this.name = "BillingError";
  }
}
const fail = (code: BillingErrorCode = "invalid_input"): never => {
  throw new BillingError(code);
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function safeProviderId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    return fail();
  return value;
}
function numericId(value: unknown): string {
  const id = safeProviderId(value);
  if (!/^[1-9][0-9]{0,19}$/.test(id)) return fail();
  return id;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("invalid_response");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return fail("invalid_response");
  return value;
}
function date(value: unknown): string | null {
  if (value == null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail("invalid_response");
  return new Date(value).toISOString();
}
export function moneyToCents(value: unknown): number {
  if (typeof value === "number") {
    const cents = Math.round(value * 100);
    if (
      !Number.isSafeInteger(cents) ||
      cents < 0 ||
      Math.abs(value * 100 - cents) > 0.000001
    )
      return fail("invalid_response");
    return cents;
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value))
    return fail("invalid_response");
  const [whole, decimal = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0)
    return fail("invalid_response");
  return cents;
}
export function normalizeCpf(value: string): string {
  if (typeof value !== "string" || !/^[0-9.\-\s]{11,18}$/.test(value))
    return fail();
  const digits = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return fail();
  for (let position = 9; position <= 10; position++) {
    let sum = 0;
    for (let index = 0; index < position; index++)
      sum += Number(digits[index]) * (position + 1 - index);
    const check = (sum * 10) % 11;
    if (Number(digits[position]) !== (check === 10 ? 0 : check)) return fail();
  }
  return digits;
}
const providerOrigins = new Set([
  "https://www.mercadopago.com.br",
  "https://mercadopago.com.br",
]);
export function safeProviderUrl(
  value: unknown,
  kind: "subscription" | "pix",
): string {
  try {
    const url = new URL(text(value, 2048));
    if (
      !providerOrigins.has(url.origin) ||
      url.username ||
      url.password ||
      url.hash
    )
      return fail("invalid_response");
    if (kind === "subscription" && url.pathname !== "/subscriptions/checkout")
      return fail("invalid_response");
    // Pix ticket links can have country-specific /payments/... paths.
    if (kind === "pix" && !/^\/(?:payments|checkout)\//.test(url.pathname))
      return fail("invalid_response");
    return url.href;
  } catch {
    return fail("invalid_response");
  }
}
function callbackUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.href.length > 2048
    )
      return fail();
    return url.href;
  } catch {
    return fail();
  }
}
type CheckoutInput = {
  checkoutId: string;
  amountCents: number;
  email: string;
  description: string;
};
export type PixInput = CheckoutInput & {
  cpf: string;
  notificationUrl: string;
  expiresAt?: string;
};
export type CardSubscriptionInput = CheckoutInput & { backUrl: string };
export type ProviderPayment = {
  id: string;
  status: string;
  statusDetail: string | null;
  amountCents: number;
  refundedCents: number;
  currency: "BRL";
  collectorId: string;
  liveMode: boolean;
  externalReference: string | null;
  paymentMethodId: string;
  approvedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
};
export type ProviderSubscription = {
  id: string;
  status: string;
  amountCents: number;
  currency: "BRL";
  collectorId: string;
  externalReference: string;
  liveMode: boolean | null;
  checkoutUrl: string | null;
  frequency: number;
  frequencyType: string;
  nextPaymentAt: string | null;
  updatedAt: string | null;
};
export type ProviderAuthorizedPayment = {
  id: string;
  subscriptionId: string;
  externalReference: string | null;
  amountCents: number;
  currency: "BRL";
  status: string;
  paymentId: string | null;
  debitAt: string | null;
  updatedAt: string | null;
};
export type CheckoutExpectation = {
  checkoutId: string;
  amountCents: number;
  collectorId: string;
  mode: BillingMode;
};
export function validatePaymentForCheckout(
  payment: ProviderPayment,
  expected: CheckoutExpectation,
  method?: "pix",
) {
  if (
    payment.externalReference !== expected.checkoutId ||
    payment.amountCents !== expected.amountCents ||
    payment.currency !== "BRL" ||
    payment.collectorId !== expected.collectorId ||
    payment.liveMode !== (expected.mode === "live") ||
    (method && payment.paymentMethodId !== method)
  )
    return fail("mismatch");
  return payment;
}
export function validateSubscriptionForCheckout(
  subscription: ProviderSubscription,
  expected: CheckoutExpectation,
) {
  if (
    subscription.externalReference !== expected.checkoutId ||
    subscription.amountCents !== expected.amountCents ||
    subscription.currency !== "BRL" ||
    subscription.collectorId !== expected.collectorId ||
    subscription.frequency !== 1 ||
    subscription.frequencyType !== "months" ||
    (subscription.liveMode !== null &&
      subscription.liveMode !== (expected.mode === "live"))
  )
    return fail("mismatch");
  return subscription;
}
/** Approval is a monetary event; a subscription authorization never calls this. */
export function isSettledPayment(payment: ProviderPayment): boolean {
  return (
    payment.status === "approved" &&
    payment.refundedCents === 0 &&
    payment.approvedAt !== null
  );
}
function validateCheckout(input: CheckoutInput) {
  if (
    !uuid.test(input.checkoutId) ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 99999999999 ||
    typeof input.email !== "string" ||
    input.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    typeof input.description !== "string" ||
    input.description.length < 1 ||
    input.description.length > 200 ||
    /[\u0000-\u001f]/.test(input.description)
  )
    return fail();
}

export class MercadoPagoClient {
  readonly #config: BillingConfig;
  readonly #fetch: typeof fetch;
  constructor(config: BillingConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = { ...config };
    this.#fetch = fetchImpl;
    if (
      !["test", "live"].includes(config.mode) ||
      typeof config.accessToken !== "string" ||
      config.accessToken.length < 16 ||
      /\s/.test(config.accessToken)
    )
      return fail("not_configured");
    try {
      numericId(config.collectorId);
    } catch {
      return fail("not_configured");
    }
    if (
      config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) ||
        config.timeoutMs < 100 ||
        config.timeoutMs > 20000)
    )
      return fail("not_configured");
  }
  async #request(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    query?: URLSearchParams,
  ): Promise<unknown> {
    if (
      !/^(?:\/v1\/payments(?:\/[1-9][0-9]{0,19})?|\/preapproval(?:\/[a-zA-Z0-9_-]{1,128})?|\/authorized_payments\/(?:[1-9][0-9]{0,19}|search))$/.test(
        path,
      )
    )
      return fail();
    const mutation = method !== "GET";
    try {
      const response = await this.#fetch(
        `https://api.mercadopago.com${path}${query ? `?${query}` : ""}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.#config.accessToken}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.#config.timeoutMs ?? 6000),
          redirect: "error",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        // Do not consume/log provider error bodies: they may echo CPF, email or tokens.
        const ambiguous =
          mutation &&
          (response.status >= 500 ||
            response.status === 408 ||
            response.status === 429);
        throw new BillingError(
          response.status >= 500 ? "unavailable" : "rejected",
          ambiguous ? "unknown" : "known",
          response.status,
        );
      }
      if (
        !/^application\/json\b/i.test(
          response.headers.get("content-type") || "",
        )
      )
        throw new BillingError(
          "invalid_response",
          mutation ? "unknown" : "known",
        );
      const raw = await response.text();
      if (raw.length > 2_000_000)
        throw new BillingError(
          "invalid_response",
          mutation ? "unknown" : "known",
        );
      try {
        return JSON.parse(raw);
      } catch {
        throw new BillingError(
          "invalid_response",
          mutation ? "unknown" : "known",
        );
      }
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError("unavailable", mutation ? "unknown" : "known");
    }
  }
  #identity(value: Record<string, unknown>, requireLive: boolean) {
    if (numericId(value.collector_id) !== this.#config.collectorId)
      return fail("mismatch");
    if (value.live_mode !== undefined && typeof value.live_mode !== "boolean")
      return fail("invalid_response");
    if (
      (requireLive || value.live_mode !== undefined) &&
      value.live_mode !== (this.#config.mode === "live")
    )
      return fail("mismatch");
    if (value.currency_id !== "BRL") return fail("mismatch");
  }
  #payment(value: unknown): ProviderPayment {
    const p = record(value);
    this.#identity(p, true);
    const point =
      p.point_of_interaction == null ? {} : record(p.point_of_interaction);
    const transaction =
      point.transaction_data == null ? {} : record(point.transaction_data);
    const qrCodeBase64 =
      transaction.qr_code_base64 == null
        ? null
        : text(transaction.qr_code_base64, 1_000_000);
    if (
      qrCodeBase64 &&
      (!/^[A-Za-z0-9+/]+={0,2}$/.test(qrCodeBase64) ||
        !Buffer.from(qrCodeBase64, "base64")
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    )
      return fail("invalid_response");
    return {
      id: numericId(p.id),
      status: text(p.status, 40),
      statusDetail: p.status_detail == null ? null : text(p.status_detail, 100),
      amountCents: moneyToCents(p.transaction_amount),
      refundedCents: moneyToCents(p.transaction_amount_refunded ?? 0),
      currency: "BRL",
      collectorId: this.#config.collectorId,
      liveMode: p.live_mode as boolean,
      externalReference:
        p.external_reference == null ? null : text(p.external_reference),
      paymentMethodId: text(p.payment_method_id, 50),
      approvedAt: date(p.date_approved),
      updatedAt: date(p.date_last_updated),
      expiresAt: date(p.date_of_expiration),
      qrCode:
        transaction.qr_code == null ? null : text(transaction.qr_code, 8192),
      qrCodeBase64,
      ticketUrl:
        transaction.ticket_url == null
          ? null
          : safeProviderUrl(transaction.ticket_url, "pix"),
    };
  }
  #subscription(value: unknown): ProviderSubscription {
    const p = record(value),
      recurring = record(p.auto_recurring);
    this.#identity({ ...p, currency_id: recurring.currency_id }, false);
    if (recurring.frequency !== 1 || recurring.frequency_type !== "months")
      return fail("mismatch");
    const id = safeProviderId(p.id);
    const checkoutUrl =
      p.init_point == null
        ? null
        : safeProviderUrl(p.init_point, "subscription");
    if (
      checkoutUrl &&
      new URL(checkoutUrl).searchParams.get("preapproval_id") !== id
    )
      return fail("mismatch");
    return {
      id,
      status: text(p.status, 40),
      amountCents: moneyToCents(recurring.transaction_amount),
      currency: "BRL",
      collectorId: this.#config.collectorId,
      externalReference: text(p.external_reference),
      liveMode: typeof p.live_mode === "boolean" ? p.live_mode : null,
      checkoutUrl,
      frequency: 1,
      frequencyType: "months",
      nextPaymentAt: date(p.next_payment_date),
      updatedAt: date(p.last_modified),
    };
  }
  async createPix(input: PixInput): Promise<ProviderPayment> {
    validateCheckout(input);
    const cpf = normalizeCpf(input.cpf),
      notificationUrl = callbackUrl(input.notificationUrl);
    const expiresAt =
      input.expiresAt === undefined ? undefined : date(input.expiresAt);
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) return fail();
    const raw = await this.#request(
      "POST",
      "/v1/payments",
      {
        transaction_amount: input.amountCents / 100,
        description: input.description,
        payment_method_id: "pix",
        external_reference: input.checkoutId,
        notification_url: notificationUrl,
        payer: {
          email: input.email,
          identification: { type: "CPF", number: cpf },
        },
        ...(expiresAt ? { date_of_expiration: expiresAt } : {}),
      },
      input.checkoutId,
    );
    try {
      return validatePaymentForCheckout(
        this.#payment(raw),
        {
          ...this.#config,
          checkoutId: input.checkoutId,
          amountCents: input.amountCents,
        },
        "pix",
      );
    } catch {
      throw new BillingError("invalid_response", "unknown");
    }
  }
  async createCardSubscription(
    input: CardSubscriptionInput,
  ): Promise<ProviderSubscription> {
    validateCheckout(input);
    const backUrl = callbackUrl(input.backUrl);
    // Caller must gate expired trial and persist a unique attempt before this call.
    // No unverified preapproval idempotency guarantee, trial reset or automatic retry.
    const raw = await this.#request("POST", "/preapproval", {
      reason: input.description,
      external_reference: input.checkoutId,
      payer_email: input.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amountCents / 100,
        currency_id: "BRL",
      },
      back_url: backUrl,
      status: "pending",
    });
    try {
      const subscription = validateSubscriptionForCheckout(
        this.#subscription(raw),
        {
          ...this.#config,
          checkoutId: input.checkoutId,
          amountCents: input.amountCents,
        },
      );
      if (subscription.status !== "pending" || !subscription.checkoutUrl)
        return fail("invalid_response");
      return subscription;
    } catch {
      throw new BillingError("invalid_response", "unknown");
    }
  }
  async getPayment(id: string): Promise<ProviderPayment> {
    id = numericId(id);
    const payment = this.#payment(
      await this.#request("GET", `/v1/payments/${id}`),
    );
    if (payment.id !== id) return fail("mismatch");
    return payment;
  }
  async getSubscription(id: string): Promise<ProviderSubscription> {
    id = safeProviderId(id);
    const subscription = this.#subscription(
      await this.#request("GET", `/preapproval/${id}`),
    );
    if (subscription.id !== id) return fail("mismatch");
    return subscription;
  }
  #authorizedPayment(value: unknown): ProviderAuthorizedPayment {
    const p = record(value),
      id = numericId(p.id);
    if (p.currency_id !== "BRL") return fail("mismatch");
    const payment = p.payment == null ? null : record(p.payment);
    // Invoice lacks collector/live_mode; caller MUST fetch subscription and payment.
    return {
      id,
      subscriptionId: safeProviderId(p.preapproval_id),
      externalReference:
        p.external_reference == null ? null : text(p.external_reference),
      amountCents: moneyToCents(p.transaction_amount),
      currency: "BRL",
      status: text(p.status, 40),
      paymentId: payment?.id == null ? null : numericId(payment.id),
      debitAt: date(p.debit_date),
      updatedAt: date(p.last_modified),
    };
  }
  async getAuthorizedPayment(id: string): Promise<ProviderAuthorizedPayment> {
    id = numericId(id);
    const invoice = this.#authorizedPayment(
      await this.#request("GET", `/authorized_payments/${id}`),
    );
    if (invoice.id !== id) return fail("mismatch");
    return invoice;
  }
  /** At most two bounded pages; caller must still GET invoices and actual payments. */
  async searchAuthorizedPayments(filters: {
    subscriptionId?: string;
    paymentId?: string;
  }): Promise<ProviderAuthorizedPayment[]> {
    if (!filters || (!filters.subscriptionId && !filters.paymentId))
      return fail();
    const subscriptionId =
      filters.subscriptionId === undefined
        ? undefined
        : safeProviderId(filters.subscriptionId);
    const paymentId =
      filters.paymentId === undefined
        ? undefined
        : numericId(filters.paymentId);
    const query = new URLSearchParams({ limit: "20", offset: "0" });
    if (subscriptionId) query.set("preapproval_id", subscriptionId);
    if (paymentId) query.set("payment_id", paymentId);
    const page = async (offset: number) => {
      query.set("offset", String(offset));
      const response = record(
        await this.#request(
          "GET",
          "/authorized_payments/search",
          undefined,
          undefined,
          query,
        ),
      );
      const paging = record(response.paging);
      if (
        !Array.isArray(response.results) ||
        response.results.length > 20 ||
        !Number.isSafeInteger(paging.total) ||
        (paging.total as number) < 0 ||
        (paging.total as number) > 1_000_000 ||
        paging.offset !== offset ||
        response.results.length !==
          Math.min(20, Math.max(0, (paging.total as number) - offset))
      )
        return fail("invalid_response");
      const seen = new Set<string>();
      const results = response.results.map((raw) => {
        const invoice = this.#authorizedPayment(raw);
        if (
          (subscriptionId && invoice.subscriptionId !== subscriptionId) ||
          (paymentId && invoice.paymentId !== paymentId) ||
          seen.has(invoice.id)
        )
          return fail("mismatch");
        seen.add(invoice.id);
        return invoice;
      });
      return { results, total: paging.total as number };
    };
    const first = await page(0);
    const last = first.total > 20 ? await page(first.total - 20) : first;
    if (last.total !== first.total) return fail("unavailable");
    const recent = (invoice: ProviderAuthorizedPayment) =>
      Date.parse(
        invoice.updatedAt || invoice.debitAt || "1970-01-01T00:00:00Z",
      );
    const unique = new Map<string, ProviderAuthorizedPayment>();
    for (const invoice of [...first.results, ...last.results]) {
      const previous = unique.get(invoice.id);
      if (!previous || recent(invoice) >= recent(previous))
        unique.set(invoice.id, invoice);
    }
    return [...unique.values()]
      .sort((a, b) => recent(b) - recent(a))
      .slice(0, 20);
  }
  /** Null never authorizes another POST after an ambiguous creation attempt. */
  async findSubscription(
    checkoutId: string,
    email: string,
  ): Promise<ProviderSubscription | null> {
    if (
      !uuid.test(checkoutId) ||
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      return fail();
    const query = new URLSearchParams({
      payer_email: email,
      limit: "20",
      offset: "0",
    });
    const response = record(
      await this.#request(
        "GET",
        "/preapproval/search",
        undefined,
        undefined,
        query,
      ),
    );
    if (!Array.isArray(response.results) || response.results.length > 20)
      return fail("invalid_response");
    const paging = record(response.paging);
    if (
      !Number.isSafeInteger(paging.total) ||
      (paging.total as number) < response.results.length ||
      paging.offset !== 0
    )
      return fail("invalid_response");
    // A truncated page cannot prove uniqueness or absence of this checkout.
    if ((paging.total as number) > response.results.length)
      return fail("unavailable");
    const matches = response.results
      .map(record)
      .filter((row) => row.external_reference === checkoutId);
    if (matches.length > 1) return fail("mismatch");
    return matches.length ? this.#subscription(matches[0]) : null;
  }
  async cancelSubscription(id: string): Promise<ProviderSubscription> {
    id = safeProviderId(id);
    const raw = await this.#request("PUT", `/preapproval/${id}`, {
      status: "cancelled",
    });
    try {
      const subscription = this.#subscription(raw);
      if (subscription.id !== id || subscription.status !== "cancelled")
        return fail("mismatch");
      return subscription;
    } catch {
      throw new BillingError("invalid_response", "unknown");
    }
  }
}

export type WebhookSignatureInput = {
  signature: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string | undefined;
  nowMs?: number;
  maxAgeMs?: number;
};
/** Signs the query id, never a body-controlled fallback. Original ts is preserved. */
export function verifyWebhookSignature(input: WebhookSignatureInput): boolean {
  const { signature, requestId, dataId, secret } = input;
  if (
    !secret ||
    secret.length < 16 ||
    !signature ||
    signature.length > 256 ||
    !requestId ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ||
    !dataId ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(dataId)
  )
    return false;
  const parts = signature.split(",").map((part) => part.trim());
  if (parts.length !== 2) return false;
  const timestamps = parts.filter((part) => /^ts=\d{10}(?:\d{3})?$/.test(part));
  const hashes = parts.filter((part) => /^v1=[a-fA-F0-9]{64}$/.test(part));
  if (timestamps.length !== 1 || hashes.length !== 1) return false;
  const ts = timestamps[0].slice(3),
    timestampMs = Number(ts) * (ts.length === 10 ? 1000 : 1);
  const now = input.nowMs ?? Date.now(),
    maxAge = input.maxAgeMs ?? 10 * 60 * 1000;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(maxAge) ||
    maxAge <= 0 ||
    maxAge > 24 * 60 * 60 * 1000 ||
    timestampMs > now + 60_000 ||
    now - timestampMs > maxAge
  )
    return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  return timingSafeEqual(expected, Buffer.from(hashes[0].slice(3), "hex"));
}
