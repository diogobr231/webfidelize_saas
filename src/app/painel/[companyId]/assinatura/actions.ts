"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  billingMessage,
  requireBillingOwner,
  createBillingCheckout,
  checkoutRedirect,
  reconcileCompany,
  cancelCompanySubscription,
} from "@/lib/billing/service";
import type { BillingActionState } from "@/lib/billing/types";

const companySchema = z.uuid();
const planSchema = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const quoteSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,8}$/)
  .transform(Number);
function field(form: FormData, name: string) {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0]
    : null;
}
function companyId(form: FormData) {
  return companySchema.safeParse(field(form, "company_id"));
}
function refresh(company: string) {
  revalidatePath(`/painel/${company}`, "layout");
}

export async function startPix(
  _: BillingActionState,
  form: FormData,
): Promise<BillingActionState> {
  const company = companyId(form),
    plan = planSchema.safeParse(field(form, "plan_id")),
    quote = quoteSchema.safeParse(field(form, "quoted_amount_cents"));
  if (!company.success || !plan.success || !quote.success)
    return { error: "Confira os dados da empresa e do plano." };
  try {
    const owner = await requireBillingOwner(company.data);
    await createBillingCheckout(
      owner,
      plan.data,
      "pix",
      quote.data,
      field(form, "cpf") || "",
    );
    refresh(company.data);
    return {
      success:
        "Cobrança consultada. Confira o QR Code e o status abaixo; o acesso depende da confirmação do pagamento.",
    };
  } catch (error) {
    refresh(company.data);
    return { error: billingMessage(error) };
  }
}
export async function startCard(
  _: BillingActionState,
  form: FormData,
): Promise<BillingActionState> {
  const company = companyId(form),
    plan = planSchema.safeParse(field(form, "plan_id")),
    quote = quoteSchema.safeParse(field(form, "quoted_amount_cents"));
  if (!company.success || !plan.success || !quote.success)
    return { error: "Confira os dados da empresa e do plano." };
  let target: string;
  try {
    const owner = await requireBillingOwner(company.data);
    target = checkoutRedirect(
      await createBillingCheckout(owner, plan.data, "card", quote.data),
    );
    refresh(company.data);
  } catch (error) {
    refresh(company.data);
    return { error: billingMessage(error) };
  }
  redirect(target);
}
export async function refreshBilling(
  _: BillingActionState,
  form: FormData,
): Promise<BillingActionState> {
  const company = companyId(form);
  if (!company.success) return { error: "Empresa inválida." };
  try {
    await requireBillingOwner(company.data);
    const result = await reconcileCompany(company.data);
    refresh(company.data);
    return {
      success: result?.company.access
        ? "Consulta concluída. Confira abaixo o período de acesso confirmado."
        : "Consulta concluída. Ainda não há um período pago disponível; confira o status da cobrança abaixo.",
    };
  } catch (error) {
    return { error: billingMessage(error) };
  }
}
export async function cancelCard(
  _: BillingActionState,
  form: FormData,
): Promise<BillingActionState> {
  const company = companyId(form);
  if (!company.success || field(form, "confirm_action") !== "yes")
    return { error: "Confirme o cancelamento da renovação para continuar." };
  try {
    await requireBillingOwner(company.data);
    await cancelCompanySubscription(company.data);
    refresh(company.data);
    return {
      success:
        "Renovação cancelada no Mercado Pago. Um período já pago permanece disponível até seu vencimento, salvo estorno ou contestação.",
    };
  } catch (error) {
    return { error: billingMessage(error) };
  }
}
