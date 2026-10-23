/**
 * Explicit, opt-in external sandbox verification; never imported by the app.
 *
 * pnpm exec tsx scripts/verify-mercado-pago-sandbox.ts pix/create --run pix-01 --amount-cents 4990
 * pnpm exec tsx scripts/verify-mercado-pago-sandbox.ts card/create --run card-01 --amount-cents 4990
 * pnpm exec tsx scripts/verify-mercado-pago-sandbox.ts inspect --run card-01
 *
 * Required: MERCADO_PAGO_TEST_ACCESS_TOKEN (TEST- only),
 * MERCADO_PAGO_TEST_COLLECTOR_ID, MERCADO_PAGO_SANDBOX_PAYER_EMAIL.
 * Pix additionally needs MERCADO_PAGO_SANDBOX_CPF and
 * MERCADO_PAGO_SANDBOX_NOTIFICATION_URL; card needs MERCADO_PAGO_SANDBOX_BACK_URL.
 * Values come from the process or those exact keys in .env.local. Never pass
 * credentials, CPF or buyer email as CLI arguments. The buyer must be an actual
 * Mercado Pago test account for hosted card checkout. Pix Payments may use the
 * explicit test email chosen by the operator (different from the seller).
 *
 * Limitations: this verifies the real provider, not browser/Auth/ledger/webhook
 * delivery. It does not configure a receiver or activate access. A test payment
 * may remain pending; only authoritative GET responses can confirm it. A card
 * authorization needs invoice + payment proof. No live token, money transfer,
 * cancellation, renewal scheduler, or automatic retry exists in this script.
 * A TEST- prefix is deliberately mandatory even when other test credentials
 * may use a different prefix. Do not weaken that guard to make a token work.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  BillingError,
  MercadoPagoClient,
  isSettledPayment,
  normalizeCpf,
  safeProviderUrl,
  validatePaymentForCheckout,
  validateSubscriptionForCheckout,
  type ProviderPayment,
  type ProviderSubscription,
} from "../src/lib/billing/core";

const keys = [
  "MERCADO_PAGO_TEST_ACCESS_TOKEN",
  "MERCADO_PAGO_TEST_COLLECTOR_ID",
  "MERCADO_PAGO_SANDBOX_PAYER_EMAIL",
  "MERCADO_PAGO_SANDBOX_CPF",
  "MERCADO_PAGO_SANDBOX_NOTIFICATION_URL",
  "MERCADO_PAGO_SANDBOX_BACK_URL",
] as const;
const usage = `Sandbox externo (sem ativar cobranças na plataforma):
  pix/create --run <nome-unico> --amount-cents <centavos>
  card/create --run <nome-unico> --amount-cents <centavos>
  inspect --run <nome-existente>
Consulte os requisitos e limites no início deste script. Credenciais somente por ambiente.
Reexecutar create com o mesmo nome nunca repete POST. inspect faz somente leitura.
Artefatos: test-results/mercado-pago-sandbox (ignorado pelo Git).`;

class VerificationError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
  }
}
const reject = (code: string): never => {
  throw new VerificationError(code);
};
const productionHosts = new Set([
  "webfidelize.com",
  "www.webfidelize.com",
  "webfidelize.com.br",
  "www.webfidelize.com.br",
  "webfidelize-saas.vercel.app",
]);
function sandboxCallback(value: string | undefined) {
  if (!value) return reject("sandbox_callback_required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject("sandbox_callback_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    value.length > 2048 ||
    productionHosts.has(url.hostname) ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.includes(":") ||
    /^[0-9.]+$/.test(url.hostname)
  )
    return reject("sandbox_callback_must_be_separate_https");
  return url.href;
}
const intentSchema = z
  .object({
    version: z.literal(1),
    checkoutId: z.uuid(),
    createdAt: z.iso.datetime(),
    kind: z.enum(["pix", "card"]),
    amountCents: z.number().int().min(1).max(1_000_000),
    currency: z.literal("BRL"),
    mode: z.literal("test"),
    collectorId: z.string().regex(/^[1-9][0-9]{0,19}$/),
    payerFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    callbackUrl: z.string(),
  })
  .strict();
type Intent = z.infer<typeof intentSchema>;
function payerFingerprint(id: string, email: string) {
  return createHash("sha256").update(`${id}\n${email}`).digest("hex");
}
function parseArgs(argv: string[]) {
  const [operation, ...args] = argv;
  if (!operation || operation === "--help") return null;
  if (!["pix/create", "card/create", "inspect"].includes(operation))
    return reject("invalid_operation");
  if (args.length % 2) return reject("invalid_arguments");
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--run", "--amount-cents"].includes(args[i]) || flags.has(args[i]))
      return reject("invalid_arguments");
    flags.set(args[i], args[i + 1]);
  }
  const run = flags.get("--run") || "";
  if (
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(run) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(run)
  )
    return reject("invalid_run_name");
  const amount = flags.get("--amount-cents");
  if (operation === "inspect") {
    if (amount !== undefined) return reject("inspect_cannot_change_amount");
    return { operation, run, amountCents: 0 };
  }
  if (
    !amount ||
    !/^[1-9][0-9]{0,6}$/.test(amount) ||
    Number(amount) > 1_000_000
  )
    return reject("explicit_amount_cents_required");
  return { operation, run, amountCents: Number(amount) };
}
async function writeDurable(path: string, data: unknown) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(data, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
}
function safeFailure(error: unknown) {
  if (error instanceof BillingError)
    return {
      code: error.code,
      outcome: error.outcome,
      ...(error.status ? { httpStatus: error.status } : {}),
    };
  if (error instanceof VerificationError)
    return { code: error.safeCode, outcome: "known" };
  return { code: "local_or_unknown_failure", outcome: "unknown" };
}
function safePayment(payment: ProviderPayment) {
  if (
    ![
      "pending",
      "in_process",
      "authorized",
      "approved",
      "rejected",
      "cancelled",
      "refunded",
      "charged_back",
    ].includes(payment.status)
  )
    throw new BillingError("invalid_response");
  return {
    providerId: payment.id,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    liveMode: payment.liveMode,
    collectorId: payment.collectorId,
    refundedCents: payment.refundedCents,
    externalReference: payment.externalReference,
    paymentMethodId: /^[a-z0-9_]{1,30}$/.test(payment.paymentMethodId)
      ? payment.paymentMethodId
      : null,
    approvedAt: payment.approvedAt,
    updatedAt: payment.updatedAt,
    expiresAt: payment.expiresAt,
    hasQrCode: Boolean(payment.qrCode),
    hasQrImage: Boolean(payment.qrCodeBase64),
    paymentConfirmedInSandbox: isSettledPayment(payment),
  };
}
function safeSubscription(subscription: ProviderSubscription) {
  if (
    !["pending", "authorized", "paused", "cancelled"].includes(
      subscription.status,
    )
  )
    throw new BillingError("invalid_response");
  let checkoutUrl: string | null = null;
  if (subscription.checkoutUrl) {
    const validated = new URL(
      safeProviderUrl(subscription.checkoutUrl, "subscription"),
    );
    if (
      validated.searchParams.getAll("preapproval_id").length !== 1 ||
      validated.searchParams.get("preapproval_id") !== subscription.id
    )
      throw new BillingError("mismatch");
    // Store only the validated public resource ID; discard arbitrary URL data.
    const clean = new URL(validated.pathname, validated.origin);
    clean.searchParams.set("preapproval_id", subscription.id);
    checkoutUrl = clean.href;
  }
  return {
    providerId: subscription.id,
    status: subscription.status,
    amountCents: subscription.amountCents,
    currency: subscription.currency,
    liveMode: subscription.liveMode,
    collectorId: subscription.collectorId,
    externalReference: subscription.externalReference,
    frequency: subscription.frequency,
    frequencyType: subscription.frequencyType,
    checkoutUrl,
    nextPaymentAt: subscription.nextPaymentAt,
    updatedAt: subscription.updatedAt,
  };
}

export async function verifySandbox(options: {
  argv: string[];
  env: Record<string, string | undefined>;
  artifactRoot?: string;
  fetchImpl?: typeof fetch;
  output?: (line: string) => void;
}) {
  const print = options.output ?? console.log;
  const parsed = parseArgs(options.argv);
  if (!parsed) {
    print(usage);
    return;
  }
  const accessToken = options.env.MERCADO_PAGO_TEST_ACCESS_TOKEN;
  if (!accessToken || !/^TEST-[A-Za-z0-9_-]{12,}$/.test(accessToken))
    return reject("test_prefix_credential_required");
  const collectorId = options.env.MERCADO_PAGO_TEST_COLLECTOR_ID;
  if (!collectorId || !/^[1-9][0-9]{0,19}$/.test(collectorId))
    return reject("test_collector_required");
  const email = options.env.MERCADO_PAGO_SANDBOX_PAYER_EMAIL;
  if (!email || !z.email().max(254).safeParse(email).success)
    return reject("explicit_test_buyer_required");
  let diagnostic: { code: string; causeCodes: number[] } | null = null;
  const transport = options.fetchImpl ?? fetch;
  const safeCodes = new Set([
    "bad_request",
    "bad-request",
    "invalid_test_user",
    "invalid_users",
    "invalid_token",
    "invalid_access_token",
    "unauthorized",
    "forbidden",
    "internal_server_error",
    "not_found",
    "pa_unauthorized_result_from_policies",
  ]);
  const provider = new MercadoPagoClient(
    { accessToken, collectorId, mode: "test" },
    async (input, init) => {
      const response = await transport(input, init);
      if (!response.ok) {
        // Diagnostics are explicit codes only. Never print/store free-form
        // message, cause descriptions, response bodies, payer data or credentials.
        diagnostic = { code: "unclassified_provider_error", causeCodes: [] };
        const reader = response.clone().body?.getReader();
        if (reader) {
          try {
            const chunks: Uint8Array[] = [];
            let size = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 8192) break;
              chunks.push(value);
            }
            if (size <= 8192) {
              const raw = JSON.parse(
                Buffer.concat(chunks).toString(),
              ) as Record<string, unknown>;
              if (
                typeof raw.error === "string" &&
                safeCodes.has(raw.error.toLowerCase())
              )
                diagnostic.code = raw.error.toLowerCase();
              if (Array.isArray(raw.cause))
                diagnostic.causeCodes = raw.cause
                  .slice(0, 8)
                  .flatMap((cause: unknown) => {
                    if (
                      !cause ||
                      typeof cause !== "object" ||
                      !("code" in cause)
                    )
                      return [];
                    const code = Number(cause.code);
                    return Number.isInteger(code) && code >= 0 && code <= 999999
                      ? [code]
                      : [];
                  });
            }
          } catch {
            /* Provider bodies are untrusted and optional. */
          } finally {
            void reader.cancel().catch(() => undefined);
          }
        }
      }
      return response;
    },
  );
  const root = resolve(
    options.artifactRoot ?? "test-results/mercado-pago-sandbox",
  );
  const directory = resolve(root, parsed.run);
  let intent: Intent;
  if (parsed.operation === "inspect") {
    try {
      intent = intentSchema.parse(
        JSON.parse(await readFile(resolve(directory, "intent.json"), "utf8")),
      );
    } catch {
      return reject("valid_existing_intent_required");
    }
    if (
      intent.collectorId !== collectorId ||
      intent.payerFingerprint !== payerFingerprint(intent.checkoutId, email)
    )
      return reject("intent_account_mismatch");
  } else {
    const kind = parsed.operation === "pix/create" ? "pix" : "card";
    const callbackUrl = sandboxCallback(
      options.env[
        kind === "pix"
          ? "MERCADO_PAGO_SANDBOX_NOTIFICATION_URL"
          : "MERCADO_PAGO_SANDBOX_BACK_URL"
      ],
    );
    if (kind === "pix")
      normalizeCpf(options.env.MERCADO_PAGO_SANDBOX_CPF || "");
    const checkoutId = randomUUID();
    intent = {
      version: 1,
      checkoutId,
      createdAt: new Date().toISOString(),
      kind,
      amountCents: parsed.amountCents,
      currency: "BRL",
      mode: "test",
      collectorId,
      payerFingerprint: payerFingerprint(checkoutId, email),
      callbackUrl,
    };
    await mkdir(root, { recursive: true });
    // Directory reservation is atomic: concurrent/repeated create never POSTs.
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch {
      return reject("run_exists_or_unavailable_use_inspect");
    }
    await writeDurable(resolve(directory, "intent.json"), intent);
  }
  const expected = {
    checkoutId: intent.checkoutId,
    amountCents: intent.amountCents,
    collectorId,
    mode: "test" as const,
  };
  const base = {
    run: parsed.run,
    checkoutId: intent.checkoutId,
    mode: "test",
    productionAccessGranted: false,
  };
  try {
    let result: Record<string, unknown>;
    if (parsed.operation !== "inspect") {
      await writeDurable(resolve(directory, "submitted.json"), {
        startedAt: new Date().toISOString(),
        method: "POST",
        kind: intent.kind,
      });
      const input = {
        checkoutId: intent.checkoutId,
        amountCents: intent.amountCents,
        email,
        description: `Web Fidelize · homologação sandbox ${intent.kind}`,
      };
      if (intent.kind === "pix") {
        const payment = await provider.createPix({
          ...input,
          cpf: options.env.MERCADO_PAGO_SANDBOX_CPF!,
          notificationUrl: intent.callbackUrl,
        });
        result = { payment: safePayment(payment) };
      } else {
        const subscription = await provider.createCardSubscription({
          ...input,
          backUrl: intent.callbackUrl,
        });
        result = {
          subscription: safeSubscription(subscription),
          paymentConfirmedInSandbox: false,
        };
      }
    } else if (intent.kind === "pix") {
      const found = await provider.findPixPayment(
        intent.checkoutId,
        intent.amountCents,
      );
      if (!found) result = { resourceFound: false, retryPostAllowed: false };
      else {
        const payment = validatePaymentForCheckout(
          await provider.getPayment(found.id),
          expected,
          "pix",
        );
        result = { resourceFound: true, payment: safePayment(payment) };
      }
    } else {
      const found = await provider.findSubscription(intent.checkoutId, email);
      if (!found) result = { resourceFound: false, retryPostAllowed: false };
      else {
        const subscription = validateSubscriptionForCheckout(
          await provider.getSubscription(found.id),
          expected,
        );
        const invoices = await provider.searchAuthorizedPayments({
          subscriptionId: subscription.id,
        });
        const payments: Record<string, unknown>[] = [];
        for (const candidate of invoices.slice(0, 3)) {
          const invoice = await provider.getAuthorizedPayment(candidate.id);
          if (
            invoice.subscriptionId !== subscription.id ||
            invoice.currency !== "BRL" ||
            invoice.amountCents !== intent.amountCents ||
            (invoice.externalReference !== null &&
              invoice.externalReference !== intent.checkoutId)
          )
            throw new BillingError("mismatch");
          if (!invoice.paymentId) continue;
          const payment = await provider.getPayment(invoice.paymentId);
          if (payment.paymentMethodId === "pix")
            throw new BillingError("mismatch");
          validatePaymentForCheckout(
            {
              ...payment,
              externalReference: payment.externalReference ?? intent.checkoutId,
            },
            expected,
          );
          payments.push({ invoiceId: invoice.id, ...safePayment(payment) });
        }
        result = {
          resourceFound: true,
          subscription: safeSubscription(subscription),
          payments,
          inspectedInvoices: Math.min(invoices.length, 3),
          paymentConfirmedInSandbox: payments.some(
            (payment) => payment.paymentConfirmedInSandbox === true,
          ),
        };
      }
    }
    const report = {
      ...base,
      checkedAt: new Date().toISOString(),
      operation: parsed.operation,
      ...result,
    };
    await writeDurable(
      resolve(directory, `result-${randomUUID()}.json`),
      report,
    );
    print(JSON.stringify(report));
  } catch (error) {
    const report = {
      ...base,
      checkedAt: new Date().toISOString(),
      operation: parsed.operation,
      error: safeFailure(error),
      providerDiagnostic: diagnostic,
      retryPostAllowed: false,
    };
    // The immutable intent/submitted marker remains if result persistence fails.
    await writeDurable(
      resolve(directory, `failure-${randomUUID()}.json`),
      report,
    ).catch(() => undefined);
    print(JSON.stringify(report));
    throw new VerificationError("sandbox_operation_not_confirmed_use_inspect");
  }
}

async function privateEnvironment() {
  const env: Record<string, string | undefined> = {};
  for (const key of keys) env[key] = process.env[key];
  if (existsSync(".env.local")) {
    const source = await readFile(".env.local", "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (
        !match ||
        !keys.includes(match[1] as (typeof keys)[number]) ||
        env[match[1]] !== undefined
      )
        continue;
      const raw = match[2];
      env[match[1]] = /^(".*"|'.*')$/.test(raw) ? raw.slice(1, -1) : raw;
    }
  }
  return env;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  // Process-local only. Never edit production env files, Vercel or the database.
  delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
  process.env.BILLING_MODE = "test";
  void (async () => {
    const argv = process.argv.slice(2);
    await verifySandbox({
      argv,
      env:
        !argv.length || argv[0] === "--help" ? {} : await privateEnvironment(),
    });
  })().catch((error: unknown) => {
    console.error(JSON.stringify({ error: safeFailure(error) }));
    process.exitCode = 1;
  });
}
