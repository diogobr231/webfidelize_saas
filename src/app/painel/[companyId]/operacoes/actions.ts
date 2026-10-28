"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  parseIndustryOperation,
  parseIndustryStatus,
} from "@/lib/industry-operations";

const uuid = z.uuid();
const path = (companyId: string) => `/painel/${companyId}/operacoes`;

export async function createIndustryOperation(form: FormData) {
  const company = uuid.safeParse(form.get("company_id"));
  if (!company.success) redirect("/painel");
  const { db, company: current } = await requireCompany(
    company.data,
    true,
    true,
  );
  const operation = parseIndustryOperation(form, current.niche);
  if (!operation) redirect(`${path(company.data)}?erro=campos`);
  const { error } = await db.rpc("create_industry_operation", {
    p_company: company.data,
    p_kind: operation.kind,
    p_name: operation.name,
    p_details: operation.details,
    p_status: operation.status,
    p_reference: operation.reference,
    p_phone: operation.phone,
    p_quantity: operation.quantity,
    p_unit: operation.unit,
    p_amount_cents: operation.amount_cents,
    p_due_at: operation.due_at,
    p_location_url: operation.location_url,
    p_related_operation_id: operation.related_operation_id,
  });
  if (error) redirect(`${path(company.data)}?erro=salvar`);
  revalidatePath(path(company.data));
  redirect(`${path(company.data)}?salvo=1`);
}

export async function changeIndustryOperationStatus(form: FormData) {
  const company = uuid.safeParse(form.get("company_id"));
  const values = parseIndustryStatus(form);
  if (!company.success || !values) redirect("/painel");
  const { db } = await requireCompany(company.data, true, true);
  const { error } = await db.rpc("change_industry_operation_status", {
    p_company: company.data,
    p_record: values.id,
    p_version: values.version,
    p_status: values.status,
  });
  if (error) redirect(`${path(company.data)}?erro=transicao`);
  revalidatePath(path(company.data));
  redirect(`${path(company.data)}?atualizado=1`);
}

export async function adjustIndustryStock(form: FormData) {
  const company = uuid.safeParse(form.get("company_id"));
  const record = uuid.safeParse(form.get("id"));
  const version = z.coerce
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .safeParse(form.get("version"));
  const delta = z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0)
    .safeParse(form.get("delta"));
  const reason = z
    .string()
    .trim()
    .min(2)
    .max(160)
    .safeParse(form.get("reason"));
  if (
    !company.success ||
    !record.success ||
    !version.success ||
    !delta.success ||
    !reason.success
  )
    redirect("/painel");
  const { db } = await requireCompany(company.data, true, true);
  const { error } = await db.rpc("adjust_industry_stock", {
    p_company: company.data,
    p_record: record.data,
    p_version: version.data,
    p_delta: delta.data,
    p_reason: reason.data,
  });
  if (error) redirect(`${path(company.data)}?erro=estoque`);
  revalidatePath(path(company.data));
  redirect(`${path(company.data)}?estoque=1`);
}
