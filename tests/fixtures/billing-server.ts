import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startFakeAuth } from "./auth-server";
import type {
  BillingCheckout,
  BillingSnapshot,
} from "../../src/lib/billing/types";

export const companyId = "11111111-1111-4111-8111-111111111111";
export const otherCompany = "22222222-2222-4222-8222-222222222222";
export const checkoutId = "33333333-3333-4333-8333-333333333333";
export const subscriptionId = "cardfixture123";
export const paymentId = "987654";
export const invoiceId = "112233";
export const gatewaySecret = "isolated-billing-gateway-secret-not-production";
export const webhookSecret = "isolated-billing-webhook-secret-not-production";
export const providerToken = "TEST-isolated-billing-token-no-real-payments";
export const cronSecret = "isolated-billing-cron-secret-not-production";
export const pixCode = "SYNTHETIC-PIX-NOT-PAYABLE";
export const pixImage =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlNIAAAAASUVORK5CYII=";

export async function startBillingFixture(publicOrigin: string) {
  const auth = await startFakeAuth(publicOrigin);
  const state = {
    role: "OWNER",
    isAdmin: false,
    enabled: true,
    trial: false,
    demo: false,
    companyStatus: "past_due",
    environment: "test" as "test" | "live",
    access: false,
    paidUntil: null as string | null,
    checkout: null as BillingCheckout | null,
    subscription: null as BillingSnapshot["subscription"],
    payments: [] as BillingSnapshot["payments"],
    claimed: false,
    cardFailure: false,
    providerUnavailable: false,
    invoiceAvailable: false,
    subscriptionStatus: "pending",
    paymentStatus: "pending",
    paymentPatch: {} as Record<string, unknown>,
    staleSnapshot: false,
    eventDone: new Set<string>(),
  };
  const rpcCalls: { name: string; body: Record<string, unknown> }[] = [];
  const providerCalls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
    idempotency: string;
  }[] = [];
  const unexpected: string[] = [];
  function reset() {
    Object.assign(state, {
      role: "OWNER",
      isAdmin: false,
      enabled: true,
      trial: false,
      demo: false,
      companyStatus: "past_due",
      environment: "test",
      access: false,
      paidUntil: null,
      checkout: null,
      subscription: null,
      payments: [],
      claimed: false,
      cardFailure: false,
      providerUnavailable: false,
      invoiceAvailable: false,
      subscriptionStatus: "pending",
      paymentStatus: "pending",
      paymentPatch: {},
      staleSnapshot: false,
    });
    state.eventDone.clear();
    rpcCalls.length = 0;
    providerCalls.length = 0;
  }
  function checkout(
    method: "pix" | "card",
    status = "creating",
  ): BillingCheckout {
    return {
      id: checkoutId,
      company_id: companyId,
      plan_id: "essencial",
      method,
      amount_cents: 4990,
      currency: "BRL",
      environment: state.environment,
      external_reference: checkoutId,
      status,
      provider_id: null,
      checkout_url: null,
      qr_code: null,
      qr_code_base64: null,
      expires_at: null,
    };
  }
  function context(createAllowed = false) {
    return state.checkout
      ? {
          ...state.checkout,
          collector_id: "123456",
          payer_email: auth.user.email,
          idempotency_key: checkoutId,
          create_allowed: createAllowed,
        }
      : null;
  }
  function providerSubscription() {
    return {
      id: subscriptionId,
      collector_id: 123456,
      external_reference: checkoutId,
      status: state.subscriptionStatus,
      last_modified: new Date().toISOString(),
      init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${subscriptionId}`,
      auto_recurring: {
        transaction_amount: 49.9,
        currency_id: "BRL",
        frequency: 1,
        frequency_type: "months",
      },
    };
  }
  function providerPayment() {
    return {
      id: Number(paymentId),
      collector_id: 123456,
      live_mode: state.environment === "live",
      external_reference: checkoutId,
      currency_id: "BRL",
      transaction_amount: 49.9,
      transaction_amount_refunded: 0,
      status: state.paymentStatus,
      payment_method_id: state.checkout?.method === "card" ? "visa" : "pix",
      date_approved:
        state.paymentStatus === "approved" ? new Date().toISOString() : null,
      date_last_updated: new Date().toISOString(),
      date_of_expiration: new Date(Date.now() + 86_400_000).toISOString(),
      point_of_interaction: {
        transaction_data: { qr_code: pixCode, qr_code_base64: pixImage },
      },
      ...state.paymentPatch,
    };
  }
  function providerInvoice() {
    return {
      id: Number(invoiceId),
      preapproval_id: subscriptionId,
      external_reference: checkoutId,
      currency_id: "BRL",
      transaction_amount: 49.9,
      status: "processed",
      payment: { id: Number(paymentId), status: "approved" },
      debit_date: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    };
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const body = JSON.parse(bytes.toString() || "{}") as Record<
      string,
      unknown
    >;
    const send = (code: number, data: unknown, count?: number) => {
      response.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(count === undefined
          ? {}
          : { "Content-Range": count ? `0-${count - 1}/${count}` : "*/0" }),
      });
      response.end(JSON.stringify(data));
    };
    const fail = (message: string) => send(400, { code: "P0001", message });
    if (url.pathname.startsWith("/auth/")) {
      const forwarded = await fetch(
        new URL(url.pathname + url.search, auth.origin),
        {
          method: request.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: request.headers.authorization || "",
          },
          ...(bytes.length ? { body: bytes.toString() } : {}),
          redirect: "manual",
        },
      );
      response.writeHead(forwarded.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(await forwarded.text());
      return;
    }
    if (url.pathname.startsWith("/__mercadopago/")) {
      const path = url.pathname.slice("/__mercadopago".length);
      providerCalls.push({
        path,
        method: request.method || "GET",
        body,
        idempotency: String(request.headers["x-idempotency-key"] || ""),
      });
      if (request.headers.authorization !== `Bearer ${providerToken}`) {
        unexpected.push("unexpected provider credential");
        return send(401, {});
      }
      if (state.providerUnavailable)
        return send(503, { message: "fixture provider unavailable" });
      if (path === "/v1/payments" && request.method === "POST")
        return send(201, providerPayment());
      if (path === "/preapproval" && request.method === "POST")
        return state.cardFailure
          ? send(503, { message: "fixture unknown outcome" })
          : send(201, providerSubscription());
      if (path === `/v1/payments/${paymentId}` && request.method === "GET")
        return send(200, providerPayment());
      if (path === `/preapproval/${subscriptionId}`) {
        if (request.method === "PUT") state.subscriptionStatus = "cancelled";
        return send(200, providerSubscription());
      }
      if (path === `/authorized_payments/${invoiceId}`)
        return state.invoiceAvailable
          ? send(200, providerInvoice())
          : send(404, {});
      if (path === "/authorized_payments/search")
        return send(200, {
          results: state.invoiceAvailable ? [providerInvoice()] : [],
          paging: {
            total: state.invoiceAvailable ? 1 : 0,
            offset: 0,
            limit: 20,
          },
        });
      if (path === "/preapproval/search")
        return send(200, {
          results: [],
          paging: { total: 0, offset: 0, limit: 20 },
        });
      unexpected.push(`provider ${request.method} ${path}`);
      return send(404, {});
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      rpcCalls.push({ name, body });
      if (name === "is_super_admin") return send(200, state.isAdmin);
      if (name === "company_access_state") {
        if (body.p_company_id !== companyId)
          return fail("company member required");
        return send(
          200,
          state.access &&
            state.companyStatus === "active" &&
            state.paidUntil !== null &&
            Date.parse(state.paidUntil) > Date.now(),
        );
      }
      if (name === "admin_company_diagnostics") {
        if (!state.isAdmin || body.p_company !== companyId)
          return fail("admin required");
        return send(200, {
          company: {
            id: companyId,
            name: "Empresa sintética billing",
            niche: "salao",
            plan_id: "essencial",
            status: state.companyStatus,
            trial_ends_at: null,
            trial_card_required: false,
            booking_enabled: false,
            booking_slug: null,
            is_demo: false,
          },
          owners: [],
          counts: {
            customers: 0,
            services: 0,
            professionals: 1,
            appointments: 0,
            classes: 0,
            blocks: 0,
            pending_invitations: 0,
          },
          access: { writable: state.access, reason: "past_due" },
        });
      }
      if (name === "billing_snapshot") {
        if (
          body.p_company_id !== companyId ||
          (state.role !== "OWNER" && !state.isAdmin)
        )
          return fail("billing owner required");
        return send(200, {
          company: {
            id: companyId,
            status: state.companyStatus,
            plan_id: "essencial",
            paid_until: state.paidUntil,
            trial_ends_at: new Date(
              Date.now() + (state.trial ? 1 : -1) * 86_400_000,
            ).toISOString(),
            access: state.access || state.trial,
          },
          configuration: {
            enabled: state.enabled,
            environment: state.environment,
          },
          checkout:
            state.staleSnapshot ||
            state.checkout?.environment === state.environment
              ? state.checkout
              : null,
          subscription:
            state.staleSnapshot ||
            state.subscription?.environment === state.environment
              ? state.subscription
              : null,
          payments: state.payments,
        });
      }
      if (name === "billing_begin_checkout") {
        if (state.role !== "OWNER" || body.p_company_id !== companyId)
          return fail("billing owner required");
        if (!state.enabled) return fail("billing unavailable");
        if (state.trial) return fail("billing trial still running");
        if (state.demo) return fail("billing company blocked");
        if (body.p_quoted_amount_cents !== 4990)
          return fail("billing quote changed");
        if (
          body.p_plan_id !== "essencial" ||
          !["pix", "card"].includes(String(body.p_method))
        )
          return fail("billing plan invalid");
        if (!state.checkout || state.checkout.environment !== state.environment)
          state.checkout = checkout(body.p_method as "pix" | "card");
        return send(200, state.checkout);
      }
      if (name === "billing_gateway") {
        if (body.p_secret !== gatewaySecret)
          return fail("billing gateway unauthorized");
        const operation = String(body.p_operation),
          payload = (body.p_payload || {}) as Record<string, unknown>;
        if (operation === "checkout_context") {
          if (payload.checkout_id !== checkoutId || !state.checkout)
            return fail("billing checkout unknown");
          const claim =
            payload.claim !== false &&
            !state.claimed &&
            state.enabled &&
            !state.trial;
          if (claim) state.claimed = true;
          return send(200, context(claim));
        }
        if (operation === "resource_context") {
          const matches =
            payload.resource_type === "payment"
              ? payload.provider_id === paymentId &&
                (state.checkout?.method === "pix" ||
                  state.payments.some(
                    (payment) =>
                      payment.provider_id === paymentId &&
                      payment.environment === state.environment,
                  ))
              : payload.provider_id === subscriptionId;
          return send(200, matches ? context() : null);
        }
        if (operation === "checkout_created") {
          if (!state.checkout) return fail("billing checkout unknown");
          Object.assign(state.checkout, {
            status: "pending",
            provider_id: payload.provider_id,
            checkout_url: payload.checkout_url || null,
            qr_code: payload.qr_code || null,
            qr_code_base64: payload.qr_code_base64 || null,
            expires_at: payload.expires_at || null,
          });
          return send(200, state.checkout);
        }
        if (operation === "checkout_failed") {
          if (!state.checkout) return fail("billing checkout unknown");
          state.checkout.status = payload.uncertain ? "unknown" : "failed";
          return send(200, state.checkout);
        }
        if (operation === "record_subscription") {
          state.subscription = {
            provider_id: String(payload.provider_id),
            environment: payload.environment as "test" | "live",
            status: String(payload.status),
            plan_id: "essencial",
            next_payment_at: null,
          };
          if (state.checkout)
            state.checkout.provider_id = String(payload.provider_id);
          return send(200, { applied: true, status: payload.status });
        }
        if (operation === "record_payment") {
          // Preserve outbound payload for assertions; do not simulate SQL entitlement logic.
          state.payments = [
            {
              provider_id: String(payload.provider_id),
              environment: payload.environment as "test" | "live",
              status: String(payload.status),
              amount_cents: Number(payload.amount_cents),
              method: payload.method as "pix" | "card",
              approved_at: payload.approved_at as string | null,
            },
            ...state.payments.filter(
              (payment) =>
                payment.provider_id !== payload.provider_id ||
                payment.environment !== payload.environment,
            ),
          ];
          return send(200, { applied: true, paid_until: null });
        }
        if (operation === "record_event")
          return send(200, {
            processed: state.eventDone.has(String(payload.event_key)),
          });
        if (operation === "event_done") {
          state.eventDone.add(String(payload.event_key));
          return send(200, { updated: true });
        }
        if (operation === "list_pending")
          return send(200, {
            checkouts: state.checkout ? [state.checkout] : [],
            subscriptions: [],
            payments: [],
            events: [],
          });
        unexpected.push(`gateway ${operation}`);
        return fail("Unknown fixture gateway operation");
      }
      unexpected.push(`rpc ${name}`);
      return fail("Unknown isolated RPC");
    }
    if (url.pathname === "/rest/v1/memberships") {
      if (url.searchParams.get("company_id") !== `eq.${companyId}`)
        return send(406, {
          code: "PGRST116",
          message: "No isolated membership",
        });
      return send(200, {
        company_id: companyId,
        user_id: auth.user.id,
        role: state.role,
      });
    }
    if (url.pathname === "/rest/v1/companies")
      return send(200, {
        id: companyId,
        name: "Empresa sintética billing",
        niche: "salao",
        plan_id: "essencial",
        status: state.companyStatus,
        trial_ends_at: new Date(
          Date.now() + (state.trial ? 1 : -1) * 86_400_000,
        ).toISOString(),
        trial_card_required: false,
        paid_until: state.paidUntil,
        is_demo: state.demo,
        logo_path: null,
        display_density: "comfortable",
        agenda_view: "day",
      });
    if (url.pathname === "/rest/v1/professionals") return send(200, [], 1);
    if (url.pathname === "/rest/v1/plans")
      return send(200, [
        {
          id: "essencial",
          name: "Essencial",
          price_cents: 4990,
          staff_limit: 1,
          team_insights: false,
          team_export: false,
        },
        {
          id: "profissional",
          name: "Profissional",
          price_cents: 8990,
          staff_limit: 3,
          team_insights: true,
          team_export: false,
        },
        {
          id: "empresarial",
          name: "Empresarial",
          price_cents: 14990,
          staff_limit: 10,
          team_insights: true,
          team_export: true,
        },
      ]);
    unexpected.push(`${request.method} ${url.pathname}`);
    return send(404, { message: "Unknown isolated request" });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    auth,
    state,
    reset,
    checkout,
    rpcCalls,
    providerCalls,
    unexpected,
    async close() {
      await new Promise<void>((done) => server.close(() => done()));
      await auth.close();
    },
  };
}
