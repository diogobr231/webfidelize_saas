"use server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  salesOfferSchema,
  salesLeadCreateSchema,
  salesLeadUpdateSchema,
  salesMoneyToCents,
  salesDateToIso,
  type SalesActionState,
} from "@/lib/sales";

async function adminDatabase() {
  const { db } = await requireUser();
  const { data, error } = await db.rpc("is_super_admin");
  if (error || data !== true) notFound();
  return db;
}
const value = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
function refresh(id?: string) {
  revalidatePath("/admin/comercial");
  revalidatePath("/admin/comercial/ofertas");
  revalidatePath("/diagnostico");
  if (id) revalidatePath(`/admin/comercial/${id}`);
}
function saveError(message: string): SalesActionState {
  if (/conflict|version|stale/i.test(message))
    return {
      error:
        "Este contato foi atualizado em outra aba. Recarregue a página antes de salvar.",
    };
  return {
    error: "Não foi possível salvar. Confira os campos e tente novamente.",
  };
}
export async function saveSalesOffer(
  _previous: SalesActionState,
  form: FormData,
): Promise<SalesActionState> {
  const db = await adminDatabase();
  const id = value(form, "id") || null;
  if (id && !z.uuid().safeParse(id).success)
    return { error: "Oferta inválida." };
  const input = salesOfferSchema.safeParse({
    slug: value(form, "slug"),
    title: value(form, "title"),
    summary: value(form, "summary"),
    niche: value(form, "niche") || null,
    active: form.get("active") === "on",
    published: form.get("published") === "on",
    setup_price_cents: salesMoneyToCents(value(form, "setup_price")),
    monthly_price_cents: salesMoneyToCents(value(form, "monthly_price")),
  });
  if (!input.success)
    return {
      error:
        "Revise a oferta. Informe valores em reais, sem separador de milhar; deixe em branco para sob consulta.",
    };
  if (id && !input.data.active && form.get("confirm_action") !== "yes")
    return { error: "Confirme o arquivamento da oferta antes de salvar." };
  const { data, error } = await db.rpc("admin_save_sales_offer", {
    p_id: id,
    p_input: input.data,
  });
  if (error || !data) return saveError(error?.message ?? "");
  refresh();
  if (!id) redirect(`/admin/comercial/ofertas?editar=${String(data)}&salvo=1`);
  return { success: "Oferta salva.", id: String(data) };
}
export async function saveSalesLead(
  _previous: SalesActionState,
  form: FormData,
): Promise<SalesActionState> {
  const db = await adminDatabase();
  const id = value(form, "id") || null;
  const version = Number(value(form, "version"));
  if (
    id &&
    (!z.uuid().safeParse(id).success ||
      !Number.isSafeInteger(version) ||
      version < 1)
  )
    return { error: "Contato inválido. Recarregue a página." };
  const fields: Record<string, unknown> = {};
  for (const key of [
    "offer_id",
    "contact_name",
    "company_name",
    "email",
    "phone",
    "niche",
    "team_size",
    "budget_range",
    "timeline",
    "decision_role",
    "challenge",
    "stage",
    "priority",
    "next_action",
    "loss_reason",
  ])
    if (form.has(key)) fields[key] = value(form, key);
  if (form.has("setup_value"))
    fields.setup_value_cents = salesMoneyToCents(value(form, "setup_value"));
  if (form.has("monthly_value"))
    fields.monthly_value_cents = salesMoneyToCents(
      value(form, "monthly_value"),
    );
  if (form.has("next_contact_at"))
    fields.next_contact_at = salesDateToIso(value(form, "next_contact_at"));
  const input = id
    ? salesLeadUpdateSchema.safeParse(fields)
    : salesLeadCreateSchema.safeParse({
        ...fields,
        source: "manual",
        consent: form.get("consent") === "yes",
      });
  if (!input.success)
    return {
      error:
        "Confira os campos obrigatórios, telefone, valores e data do próximo contato.",
    };
  if (
    fields.stage === "lost" &&
    (form.get("confirm_action") !== "yes" ||
      value(form, "loss_reason").length < 3)
  )
    return {
      error:
        "Informe o motivo da perda e confirme o encerramento desta negociação.",
    };
  const { data, error } = await db.rpc("admin_save_sales_lead", {
    p_id: id,
    p_expected_version: id ? version : null,
    p_input: input.data,
  });
  if (error || !data) return saveError(error?.message ?? "");
  refresh(String(data));
  if (!id) redirect(`/admin/comercial/${String(data)}?salvo=1`);
  return {
    success:
      "Contato salvo. O registro comercial não altera cobranças ou assinaturas.",
    id: String(data),
  };
}
export async function addSalesNote(
  _previous: SalesActionState,
  form: FormData,
): Promise<SalesActionState> {
  const db = await adminDatabase();
  const input = z
    .object({ lead_id: z.uuid(), body: z.string().trim().min(3).max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!input.success)
    return { error: "Escreva uma anotação entre 3 e 2.000 caracteres." };
  const { error } = await db.rpc("admin_add_sales_note", {
    p_lead_id: input.data.lead_id,
    p_body: input.data.body,
  });
  if (error) return { error: "Não foi possível salvar a anotação." };
  refresh(input.data.lead_id);
  return { success: "Anotação adicionada ao histórico." };
}
