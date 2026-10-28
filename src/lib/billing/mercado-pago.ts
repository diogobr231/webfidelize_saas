import "server-only";
import {
  BillingError,
  MercadoPagoClient,
  verifyWebhookSignature,
  type BillingConfig,
} from "./core";

function config(): BillingConfig | null {
  const mode = process.env.BILLING_MODE;
  const accessToken =
    mode === "test"
      ? process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN
      : process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const collectorId = process.env.MERCADO_PAGO_COLLECTOR_ID;
  const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (
    (mode !== "test" && mode !== "live") ||
    !accessToken ||
    accessToken.length < 16 ||
    /\s/.test(accessToken) ||
    !collectorId ||
    !/^[1-9][0-9]{0,19}$/.test(collectorId) ||
    !webhookSecret ||
    webhookSecret.length < 16
  )
    return null;
  return { mode, accessToken, collectorId };
}
export function isBillingConfigured(): boolean {
  return config() !== null;
}
export function getBillingProvider(): MercadoPagoClient {
  const value = config();
  if (!value) throw new BillingError("not_configured");
  return new MercadoPagoClient(value);
}
export function verifyMercadoPagoWebhook(
  headers: Headers,
  query: URLSearchParams,
): boolean {
  if (!config() || query.getAll("data.id").length !== 1) return false;
  return verifyWebhookSignature({
    signature: headers.get("x-signature"),
    requestId: headers.get("x-request-id"),
    dataId: query.get("data.id"),
    secret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
  });
}
export type {
  ProviderPayment,
  ProviderSubscription,
  ProviderAuthorizedPayment,
  CheckoutExpectation,
} from "./core";
