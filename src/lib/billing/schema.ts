import { z } from "zod";
import { BillingError, safeProviderUrl } from "./core";

const date = z
  .string()
  .max(40)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
  );
const providerId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const planId = z.string().min(1).max(100);
export const checkoutSchema = z
  .object({
    id: z.uuid(),
    company_id: z.uuid(),
    plan_id: planId,
    method: z.enum(["pix", "card"]),
    amount_cents: z.number().int().positive().max(999999999),
    currency: z.literal("BRL"),
    environment: z.enum(["test", "live"]),
    external_reference: z.uuid(),
    status: z.enum([
      "creating",
      "pending",
      "unknown",
      "completed",
      "failed",
      "expired",
    ]),
    provider_id: providerId.nullable(),
    checkout_url: z.string().max(2000).nullable(),
    qr_code: z.string().max(16000).nullable(),
    qr_code_base64: z.string().max(150000).nullable(),
    expires_at: date.nullable(),
  })
  .superRefine((checkout, ctx) => {
    if (checkout.external_reference !== checkout.id)
      ctx.addIssue({ code: "custom", message: "Reference mismatch" });
    if (checkout.checkout_url) {
      try {
        if (
          checkout.method !== "card" ||
          new URL(
            safeProviderUrl(checkout.checkout_url, "subscription"),
          ).searchParams.get("preapproval_id") !== checkout.provider_id
        )
          throw new Error();
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid provider link" });
      }
    }
    if (
      checkout.qr_code_base64 &&
      (!/^[A-Za-z0-9+/]+={0,2}$/.test(checkout.qr_code_base64) ||
        !Buffer.from(checkout.qr_code_base64, "base64")
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid QR image" });
    }
  });
export const contextSchema = checkoutSchema.safeExtend({
  collector_id: z.string().regex(/^[1-9][0-9]{0,19}$/),
  payer_email: z.email().max(254),
  create_allowed: z.boolean().optional(),
  idempotency_key: z.uuid().optional(),
});
export type CheckoutContext = z.infer<typeof contextSchema>;
export const snapshotSchema = z.object({
  company: z.object({
    id: z.uuid(),
    status: z.string().max(40),
    plan_id: planId,
    paid_until: date.nullable(),
    trial_ends_at: date.nullable(),
    access: z.boolean(),
  }),
  configuration: z.object({
    enabled: z.boolean(),
    environment: z.enum(["test", "live"]),
  }),
  checkout: checkoutSchema.nullable(),
  subscription: z
    .object({
      provider_id: providerId,
      environment: z.enum(["test", "live"]),
      status: z.enum(["pending", "authorized", "paused", "cancelled"]),
      plan_id: planId,
      next_payment_at: date.nullable(),
    })
    .nullable(),
  payments: z
    .array(
      z.object({
        provider_id: providerId,
        environment: z.enum(["test", "live"]),
        status: z.string().max(40),
        amount_cents: z.number().int().nonnegative(),
        method: z.enum(["pix", "card"]),
        approved_at: date.nullable(),
      }),
    )
    .max(20),
});
export const pendingSchema = z.object({
  checkouts: z.array(checkoutSchema).max(50),
  subscriptions: z
    .array(
      z.object({
        external_reference: z.uuid(),
        provider_id: providerId,
        environment: z.enum(["test", "live"]),
      }),
    )
    .max(50),
  payments: z
    .array(
      z.object({
        external_reference: z.uuid(),
        provider_id: providerId,
        environment: z.enum(["test", "live"]),
        method: z.enum(["pix", "card"]),
        subscription_id: providerId.nullable(),
      }),
    )
    .max(50),
  events: z
    .array(
      z.object({
        event_key: z.string().max(200),
        event_type: z.enum([
          "payment",
          "subscription_preapproval",
          "subscription_authorized_payment",
        ]),
        resource_id: providerId,
      }),
    )
    .max(50),
});
export function validated<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new BillingError("invalid_response");
  return parsed.data;
}
