import "server-only";
import { requireCompany } from "@/lib/auth";
import { resolveAuthOrigin } from "@/lib/auth-flow";
import { publicDatabase } from "@/lib/supabase/public";
import { BillingError, normalizeCpf, safeProviderUrl } from "./core";
import { getBillingProvider, isBillingConfigured } from "./mercado-pago";
import { checkoutSchema, snapshotSchema, validated } from "./schema";
import { BillingWorkflow, type BillingGateway } from "./workflow";
import type { BillingCheckout, BillingMethod, BillingSnapshot } from "./types";

export class BillingActionError extends Error {}
const databaseErrors: Record<string, string> = {
  "billing unavailable":
    "A contratação está temporariamente indisponível. Seu período de teste continua com a data original.",
  "billing owner required": "Somente o proprietário pode gerenciar pagamentos.",
  "billing trial still running":
    "Aproveite seu teste. A contratação fica disponível após o término dos sete dias.",
  "billing company blocked":
    "Esta empresa não está habilitada para contratar. Entre em contato com o suporte.",
  "billing plan capacity":
    "O plano escolhido não comporta sua equipe atual. Escolha um plano com mais profissionais.",
  "billing price changed":
    "O valor do plano foi atualizado. Atualize a página, confira o novo preço e confirme novamente antes de pagar.",
  "billing card contract exists":
    "Já existe uma assinatura no cartão. Consulte ou cancele a renovação antes de iniciar outra.",
  "billing current period still running":
    "Aguarde o término do período pago para trocar de plano ou de modalidade.",
  "billing checkout already open":
    "Já existe uma cobrança em andamento. Verifique seu status antes de criar outra.",
};
export function billingMessage(error: unknown): string {
  if (error instanceof BillingActionError) return error.message;
  if (error instanceof BillingError) {
    if (error.outcome === "unknown")
      return "O Mercado Pago ainda não confirmou a criação. Use Verificar pagamento antes de tentar novamente; não iniciaremos uma segunda assinatura automaticamente.";
    if (error.code === "invalid_input")
      return "Confira os dados informados e tente novamente.";
    if (error.code === "rejected")
      return "O Mercado Pago não concluiu esta solicitação. Verifique os dados ou fale com o suporte.";
    if (error.code === "not_configured")
      return "A contratação está temporariamente indisponível. Tente novamente mais tarde.";
  }
  return "Não foi possível confirmar a operação. Use Verificar pagamento para consultar o status sem gerar nova cobrança.";
}
export function billingReady(): boolean {
  try {
    resolveAuthOrigin(process.env.APP_URL, true);
    return (
      isBillingConfigured() &&
      (process.env.BILLING_GATEWAY_SECRET?.length ?? 0) >= 32
    );
  } catch {
    return false;
  }
}
export function billingGateway(): BillingGateway {
  const secret = process.env.BILLING_GATEWAY_SECRET;
  if (!secret || secret.length < 32) throw new BillingError("not_configured");
  const db = publicDatabase();
  return async (operation, payload) => {
    const { data, error } = await db.rpc("billing_gateway", {
      p_secret: secret,
      p_operation: operation,
      p_payload: payload,
    });
    if (error) {
      if (error.message === "billing checkout unknown")
        throw new BillingError("invalid_input");
      throw new BillingError("unavailable");
    }
    return data;
  };
}
export function billingWorkflow(gateway = billingGateway()) {
  if (!billingReady()) throw new BillingError("not_configured");
  return new BillingWorkflow(
    getBillingProvider(),
    gateway,
    process.env.BILLING_MODE as "test" | "live",
    process.env.MERCADO_PAGO_COLLECTOR_ID!,
  );
}
export async function requireBillingOwner(companyId: string) {
  const context = await requireCompany(companyId, false, true);
  if (context.role !== "OWNER" || !context.user.email_confirmed_at)
    throw new BillingActionError(
      "Somente o proprietário com e-mail confirmado pode gerenciar pagamentos.",
    );
  return context;
}
export async function getBillingSnapshot(
  companyId: string,
): Promise<BillingSnapshot | null> {
  const { db, role } = await requireCompany(companyId, false, true);
  if (role !== "OWNER") return null;
  const { data, error } = await db.rpc("billing_snapshot", {
    p_company_id: companyId,
  });
  if (error) return null;
  const parsed = snapshotSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.company.id !== companyId ||
    (parsed.data.checkout && parsed.data.checkout.company_id !== companyId)
  )
    return null;
  const snapshot = parsed.data;
  snapshot.configuration.enabled &&=
    billingReady() &&
    snapshot.configuration.environment === process.env.BILLING_MODE;
  // Preserve labeled payment history, but never operate on a checkout or card
  // contract from credentials belonging to a different environment.
  if (snapshot.checkout?.environment !== snapshot.configuration.environment)
    snapshot.checkout = null;
  if (snapshot.subscription?.environment !== snapshot.configuration.environment)
    snapshot.subscription = null;
  return snapshot;
}
export async function createBillingCheckout(
  context: Awaited<ReturnType<typeof requireBillingOwner>>,
  planId: string,
  method: BillingMethod,
  quotedAmountCents: number,
  cpf?: string,
): Promise<BillingCheckout> {
  if (!billingReady()) throw new BillingError("not_configured");
  // Validate transient payer details before creating any database attempt.
  const normalizedCpf = method === "pix" ? normalizeCpf(cpf || "") : null;
  const { data, error } = await context.db.rpc("billing_begin_checkout", {
    p_company_id: context.company.id,
    p_plan_id: planId,
    p_method: method,
    p_quoted_amount_cents: quotedAmountCents,
  });
  if (error)
    throw new BillingActionError(
      databaseErrors[error.message] ||
        "Não foi possível iniciar a cobrança. Verifique o plano e o status da assinatura.",
    );
  const attempt = validated(checkoutSchema, data);
  if (
    attempt.company_id !== context.company.id ||
    attempt.plan_id !== planId ||
    attempt.method !== method ||
    attempt.environment !== process.env.BILLING_MODE
  )
    throw new BillingError("mismatch");
  if (attempt.amount_cents !== quotedAmountCents)
    throw new BillingActionError(
      "O valor do plano foi atualizado. Confira o preço da cobrança na página e confirme novamente antes de pagar.",
    );
  if (attempt.provider_id) return attempt;
  const gateway = billingGateway(),
    workflow = billingWorkflow(gateway);
  const claim = workflow.validateContext(
    await gateway("checkout_context", { checkout_id: attempt.id }),
  );
  if (
    claim.id !== attempt.id ||
    claim.company_id !== attempt.company_id ||
    claim.plan_id !== attempt.plan_id ||
    claim.method !== attempt.method ||
    claim.amount_cents !== attempt.amount_cents ||
    (claim.idempotency_key && claim.idempotency_key !== attempt.id)
  )
    throw new BillingError("mismatch");
  if (!claim.create_allowed) {
    await workflow.checkout(attempt.id);
    const recovered = await workflow.context(attempt.id);
    if (recovered?.provider_id) return recovered;
    throw new BillingActionError(
      "Esta cobrança está em verificação. Aguarde e use Verificar pagamento; nenhuma nova assinatura será criada automaticamente.",
    );
  }
  const provider = getBillingProvider();
  try {
    const origin = resolveAuthOrigin(process.env.APP_URL, true);
    const input = {
      checkoutId: claim.id,
      amountCents: claim.amount_cents,
      email: claim.payer_email,
      description: `Web Fidelize · plano ${claim.plan_id} · mensal`,
    };
    if (method === "pix") {
      const payment = await provider.createPix({
        ...input,
        cpf: normalizedCpf!,
        notificationUrl: `${origin}/api/webhooks/mercadopago`,
        // Provider default is 24 h. Omitting a moving date keeps retries with
        // the same idempotency key identical, including delayed recovery.
      });
      await gateway("checkout_created", {
        checkout_id: claim.id,
        provider_id: payment.id,
        qr_code: payment.qrCode,
        qr_code_base64: payment.qrCodeBase64,
        expires_at: payment.expiresAt,
      });
      await workflow.recordPayment(payment, claim);
    } else {
      const subscription = await provider.createCardSubscription({
        ...input,
        backUrl: `${origin}/painel/${claim.company_id}/assinatura`,
      });
      await gateway("checkout_created", {
        checkout_id: claim.id,
        provider_id: subscription.id,
        checkout_url: subscription.checkoutUrl,
      });
      await workflow.recordSubscription(subscription, claim);
    }
    const saved = await workflow.context(claim.id);
    if (!saved?.provider_id)
      throw new BillingError("invalid_response", "unknown");
    return saved;
  } catch (error) {
    const knownRejection =
      error instanceof BillingError &&
      error.outcome === "known" &&
      ["rejected", "invalid_input", "not_configured"].includes(error.code);
    await gateway("checkout_failed", {
      checkout_id: claim.id,
      uncertain: !knownRejection,
      error_code: knownRejection ? "provider_rejected" : "creation_unknown",
    }).catch(() => undefined);
    if (knownRejection) throw error;
    throw new BillingError("unavailable", "unknown");
  }
}
export async function reconcileCompany(companyId: string) {
  const snapshot = await getBillingSnapshot(companyId);
  if (!snapshot?.configuration.enabled)
    throw new BillingError("not_configured");
  const workflow = billingWorkflow();
  if (snapshot.checkout?.environment === snapshot.configuration.environment)
    await workflow.checkout(snapshot.checkout.id);
  // Re-read recent settled resources to detect refunds as well as new invoices.
  for (const payment of snapshot.payments
    .filter((item) => item.environment === snapshot.configuration.environment)
    .slice(0, 3))
    await workflow.event("payment", payment.provider_id);
  return getBillingSnapshot(companyId);
}
export async function cancelCompanySubscription(companyId: string) {
  const snapshot = await getBillingSnapshot(companyId);
  if (
    !snapshot?.configuration.enabled ||
    !snapshot.subscription ||
    snapshot.subscription.environment !== snapshot.configuration.environment
  )
    throw new BillingError("not_configured");
  const workflow = billingWorkflow();
  const provider = getBillingProvider();
  const before = await provider.getSubscription(
    snapshot.subscription.provider_id,
  );
  const context = await workflow.context(before.externalReference);
  if (
    !context ||
    context.company_id !== companyId ||
    context.provider_id !== before.id
  )
    throw new BillingError("mismatch");
  await workflow.recordSubscription(before, context);
  if (before.status === "cancelled") return;
  const after = await provider.cancelSubscription(before.id);
  await workflow.recordSubscription(after, context);
  if (after.status !== "cancelled")
    throw new BillingError("unavailable", "unknown");
}
export function checkoutRedirect(checkout: BillingCheckout): string {
  if (
    !checkout.checkout_url ||
    checkout.method !== "card" ||
    checkout.status !== "pending" ||
    checkout.environment !== process.env.BILLING_MODE
  )
    throw new BillingActionError(
      "A assinatura está em verificação. Consulte seu status antes de continuar.",
    );
  return safeProviderUrl(checkout.checkout_url, "subscription");
}
