"use server";

import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompany } from "@/lib/auth";
import {
  archiveBusinessRecordSchema,
  businessContextSchema,
  businessRecordError,
  updateBusinessRecordSchema,
  type BusinessContext,
  type BusinessRecordState,
} from "@/lib/business-records";

async function authorized(context: BusinessContext) {
  const parsed = businessContextSchema.safeParse(context);
  if (!parsed.success) notFound();
  return requireCompany(parsed.data.companyId, true, true);
}
function refresh(context: BusinessContext, slug: string | null) {
  revalidatePath(`/painel/${context.companyId}`, "layout");
  if (slug) revalidatePath(`/agendar/${slug}`);
}
export async function updateRecord(
  context: BusinessContext,
  _previous: BusinessRecordState,
  form: FormData,
): Promise<BusinessRecordState> {
  const { db, company } = await authorized(context);
  const values = Object.fromEntries(
    ["version", "name", "phone", "duration", "price"].map((field) => [
      field,
      typeof form.get(field) === "string" ? String(form.get(field)) : "",
    ]),
  );
  const input = updateBusinessRecordSchema.safeParse({
    ...values,
    section: context.section,
  });
  if (!input.success)
    return {
      error: "Confira os campos indicados. Nenhuma alteração foi salva.",
      fields: Object.fromEntries(
        input.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
      values,
      feedbackKey: randomUUID(),
    };
  const data = input.data;
  const { error } = await db.rpc("update_business_record", {
    p_company: context.companyId,
    p_section: context.section,
    p_record: context.recordId,
    p_version: data.version,
    p_name: data.name,
    p_phone: data.section === "customers" ? data.phone : null,
    p_duration: data.section === "services" ? data.duration : null,
    p_price: data.section === "services" ? data.price : null,
  });
  if (error)
    return {
      error: businessRecordError(error.message),
      values,
      feedbackKey: randomUUID(),
    };
  refresh(context, company.booking_slug);
  redirect(
    `/painel/${context.companyId}/${context.section}/${context.recordId}?salvo=1`,
  );
}
export async function archiveRecord(
  context: BusinessContext,
  _previous: BusinessRecordState,
  form: FormData,
): Promise<BusinessRecordState> {
  const { db, company } = await authorized(context);
  const input = archiveBusinessRecordSchema.safeParse(Object.fromEntries(form));
  if (!input.success)
    return {
      error:
        "Confirme a alteração. Se a ficha estiver desatualizada, abra a versão atual.",
      feedbackKey: randomUUID(),
    };
  const { error } = await db.rpc("archive_business_record", {
    p_company: context.companyId,
    p_section: context.section,
    p_record: context.recordId,
    p_version: input.data.version,
    p_archived: input.data.archived,
  });
  if (error)
    return {
      error: businessRecordError(error.message),
      feedbackKey: randomUUID(),
    };
  refresh(context, company.booking_slug);
  redirect(
    `/painel/${context.companyId}/${context.section}/${context.recordId}?aviso=${input.data.archived ? "arquivado" : "reativado"}`,
  );
}
