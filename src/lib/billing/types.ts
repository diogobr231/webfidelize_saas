export type BillingActionState = { error?: string; success?: string };
export type BillingMethod = "pix" | "card";
export type BillingEnvironment = "test" | "live";
export type BillingCheckout = {
  id: string;
  company_id: string;
  plan_id: string;
  method: BillingMethod;
  amount_cents: number;
  currency: string;
  environment: BillingEnvironment;
  external_reference: string;
  status: string;
  provider_id: string | null;
  checkout_url: string | null;
  qr_code: string | null;
  qr_code_base64: string | null;
  expires_at: string | null;
};
export type BillingSnapshot = {
  company: {
    id: string;
    status: string;
    plan_id: string;
    paid_until: string | null;
    trial_ends_at: string | null;
    access: boolean;
  };
  configuration: { enabled: boolean; environment: BillingEnvironment };
  checkout: BillingCheckout | null;
  subscription: {
    provider_id: string;
    environment: BillingEnvironment;
    status: string;
    plan_id: string;
    next_payment_at: string | null;
  } | null;
  payments: {
    provider_id: string;
    environment: BillingEnvironment;
    status: string;
    amount_cents: number;
    method: BillingMethod;
    approved_at: string | null;
    created_at?: string;
    period_end?: string | null;
  }[];
};
