import {
  BillingError,
  validatePaymentForCheckout,
  validateSubscriptionForCheckout,
  type MercadoPagoClient,
  type ProviderPayment,
  type ProviderSubscription,
  type ProviderAuthorizedPayment,
} from "./core";
import { contextSchema, validated, type CheckoutContext } from "./schema";
import type { BillingEnvironment } from "./types";

export type BillingGateway = (
  operation: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;
export type BillingTopic =
  | "payment"
  | "subscription_preapproval"
  | "subscription_authorized_payment";
export class BillingWorkflow {
  constructor(
    private readonly provider: MercadoPagoClient,
    private readonly gateway: BillingGateway,
    private readonly mode: BillingEnvironment,
    private readonly collectorId: string,
  ) {}

  async context(checkoutId: string): Promise<CheckoutContext | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        checkoutId,
      )
    )
      return null;
    try {
      const raw = await this.gateway("checkout_context", {
        checkout_id: checkoutId,
        claim: false,
      });
      if (!raw) return null;
      const context = this.validateContext(raw);
      if (context.id !== checkoutId) throw new BillingError("mismatch");
      return context;
    } catch (error) {
      if (error instanceof BillingError && error.code === "invalid_input")
        return null;
      throw error;
    }
  }
  validateContext(raw: unknown): CheckoutContext {
    const context = validated(contextSchema, raw);
    if (
      context.environment !== this.mode ||
      context.collector_id !== this.collectorId
    )
      throw new BillingError("mismatch");
    return context;
  }
  private expected(context: CheckoutContext) {
    return {
      checkoutId: context.id,
      amountCents: context.amount_cents,
      collectorId: context.collector_id,
      mode: context.environment,
    };
  }
  async recordSubscription(
    subscription: ProviderSubscription,
    context: CheckoutContext,
  ) {
    if (
      context.method !== "card" ||
      (context.provider_id && context.provider_id !== subscription.id)
    )
      throw new BillingError("mismatch");
    validateSubscriptionForCheckout(subscription, this.expected(context));
    if (!subscription.updatedAt) throw new BillingError("invalid_response");
    await this.gateway("record_subscription", {
      external_reference: context.id,
      provider_id: subscription.id,
      status: subscription.status,
      amount_cents: subscription.amountCents,
      currency: subscription.currency,
      collector_id: subscription.collectorId,
      environment: context.environment,
      next_payment_at: subscription.nextPaymentAt,
      last_modified: subscription.updatedAt,
    });
  }
  async recordPayment(
    payment: ProviderPayment,
    context: CheckoutContext,
    invoice?: ProviderAuthorizedPayment,
  ) {
    if (context.method === "pix") {
      validatePaymentForCheckout(payment, this.expected(context), "pix");
      if (context.provider_id && context.provider_id !== payment.id)
        throw new BillingError("mismatch");
    } else {
      // A recurring invoice (or an already stored payment resource) proves this
      // relationship. Mercado Pago can omit external_reference on card payments.
      validatePaymentForCheckout(
        {
          ...payment,
          externalReference: payment.externalReference ?? context.id,
        },
        this.expected(context),
      );
      if (
        !context.provider_id ||
        (invoice &&
          (invoice.subscriptionId !== context.provider_id ||
            invoice.paymentId !== payment.id ||
            invoice.amountCents !== context.amount_cents ||
            invoice.currency !== "BRL" ||
            (invoice.externalReference !== null &&
              invoice.externalReference !== context.id)))
      )
        throw new BillingError("mismatch");
    }
    if (
      !payment.updatedAt ||
      (payment.status === "approved" && !payment.approvedAt)
    )
      throw new BillingError("invalid_response");
    // A creation response can be lost, or its QR persistence can fail. Restore
    // display data only after the same authoritative checks used by the ledger.
    // The database keeps terminal checkouts terminal even if a webhook races us.
    if (
      context.method === "pix" &&
      ["creating", "unknown", "pending"].includes(context.status) &&
      ["pending", "in_process", "authorized"].includes(payment.status) &&
      (!context.provider_id ||
        (!context.qr_code && payment.qrCode) ||
        (!context.qr_code_base64 && payment.qrCodeBase64) ||
        (!context.expires_at && payment.expiresAt))
    ) {
      await this.gateway("checkout_created", {
        checkout_id: context.id,
        provider_id: payment.id,
        qr_code: context.qr_code ?? payment.qrCode,
        qr_code_base64: context.qr_code_base64 ?? payment.qrCodeBase64,
        expires_at: context.expires_at ?? payment.expiresAt,
      });
    }
    await this.gateway("record_payment", {
      external_reference: context.id,
      provider_id: payment.id,
      status:
        payment.refundedCents > 0 && payment.status === "approved"
          ? "refunded"
          : payment.status,
      amount_cents: payment.amountCents,
      currency: payment.currency,
      collector_id: payment.collectorId,
      environment: context.environment,
      method: context.method,
      approved_at: payment.approvedAt,
      last_modified: payment.updatedAt,
      ...(context.method === "card"
        ? {
            subscription_id: context.provider_id,
            ...(invoice ? { authorized_payment_id: invoice.id } : {}),
          }
        : {}),
    });
  }
  async invoice(
    id: string,
    expectedSubscriptionId?: string,
    knownPayment?: ProviderPayment,
  ) {
    const [invoice, prefetchedSubscription] = await Promise.all([
      this.provider.getAuthorizedPayment(id),
      expectedSubscriptionId
        ? this.provider.getSubscription(expectedSubscriptionId)
        : Promise.resolve(null),
    ]);
    if (
      expectedSubscriptionId &&
      invoice.subscriptionId !== expectedSubscriptionId
    )
      throw new BillingError("mismatch");
    const [subscription, payment] = await Promise.all([
      prefetchedSubscription
        ? Promise.resolve(prefetchedSubscription)
        : this.provider.getSubscription(invoice.subscriptionId),
      knownPayment
        ? Promise.resolve(knownPayment)
        : invoice.paymentId
          ? this.provider.getPayment(invoice.paymentId)
          : Promise.resolve(null),
    ]);
    const context = await this.context(subscription.externalReference);
    if (!context) return;
    if (context.provider_id && context.provider_id !== subscription.id)
      throw new BillingError("mismatch");
    await this.recordSubscription(subscription, context);
    if (!invoice.paymentId || !payment) return;
    await this.recordPayment(
      payment,
      { ...context, provider_id: subscription.id },
      invoice,
    );
  }
  async event(topic: BillingTopic, id: string) {
    if (topic === "subscription_authorized_payment") return this.invoice(id);
    if (topic === "subscription_preapproval") {
      const subscription = await this.provider.getSubscription(id);
      const context = await this.context(subscription.externalReference);
      if (context) await this.recordSubscription(subscription, context);
      return;
    }
    const payment = await this.provider.getPayment(id);
    const saved = await this.gateway("resource_context", {
      provider_id: id,
      resource_type: "payment",
    });
    const context = saved
      ? this.validateContext(saved)
      : payment.externalReference
        ? await this.context(payment.externalReference)
        : null;
    if (context?.method === "pix") {
      await this.recordPayment(payment, context);
      return;
    }
    if (saved && context?.method === "card") {
      // Resource lookup is backed by the payment ledger, never by a browser ID.
      await this.recordPayment(payment, context);
      return;
    }
    // A payment notification can precede the subscription notification. Find
    // its invoice by payment_id; external_reference alone cannot grant access.
    const invoices = await this.provider.searchAuthorizedPayments({
      paymentId: id,
    });
    const matching = invoices.filter((invoice) => invoice.paymentId === id);
    if (matching.length > 1) throw new BillingError("mismatch");
    if (matching.length === 1)
      await this.invoice(matching[0].id, matching[0].subscriptionId, payment);
  }
  async checkout(checkoutId: string) {
    let context = await this.context(checkoutId);
    if (!context) return;
    if (context.method === "pix") {
      const payment = context.provider_id
        ? await this.provider.getPayment(context.provider_id)
        : await this.provider.findPixPayment(context.id, context.amount_cents);
      if (payment) await this.recordPayment(payment, context);
      return;
    }
    const subscription = context.provider_id
      ? await this.provider.getSubscription(context.provider_id)
      : await this.provider.findSubscription(context.id, context.payer_email);
    if (!subscription) return; // No match never authorizes a second blind POST.
    validateSubscriptionForCheckout(subscription, this.expected(context));
    if (!context.provider_id && subscription.checkoutUrl) {
      await this.gateway("checkout_created", {
        checkout_id: context.id,
        provider_id: subscription.id,
        checkout_url: subscription.checkoutUrl,
      });
    }
    await this.recordSubscription(subscription, context);
    context = { ...context, provider_id: subscription.id };
    const invoices = await this.provider.searchAuthorizedPayments({
      subscriptionId: subscription.id,
    });
    // Bounded recovery. Every result is refetched authoritatively, and each
    // invoice/payment is idempotent in the database.
    await Promise.all(
      invoices
        .filter((item) => item.paymentId)
        .sort(
          (a, b) =>
            Date.parse(b.updatedAt || b.debitAt || "1970-01-01") -
            Date.parse(a.updatedAt || a.debitAt || "1970-01-01"),
        )
        .slice(0, 3)
        .map(async (invoice) => {
          if (invoice.subscriptionId !== subscription.id)
            throw new BillingError("mismatch");
          const [proof, payment] = await Promise.all([
            this.provider.getAuthorizedPayment(invoice.id),
            this.provider.getPayment(invoice.paymentId!),
          ]);
          if (!proof.paymentId) return;
          await this.recordPayment(payment, context, proof);
        }),
    );
  }
}
