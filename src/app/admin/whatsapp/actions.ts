"use server";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { WhatsAppFormState } from "@/lib/whatsapp-forms";

export async function setCompanyWhatsAppLimit(
  companyId: string,
  _previous: WhatsAppFormState,
  form: FormData,
): Promise<WhatsAppFormState> {
  const { db } = await requireUser();
  const admin = await db.rpc("is_super_admin");
  if (admin.error || !admin.data || !z.uuid().safeParse(companyId).success)
    notFound();
  const value = form.get("platform_limit");
  const limit = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .safeParse(value === "" || value === null ? NaN : value);
  if (!limit.success)
    return { error: "Informe um limite inteiro entre zero e 100.000." };
  const { error } = await db.rpc("admin_set_whatsapp_limit", {
    p_company: companyId,
    p_limit: limit.data,
  });
  if (error)
    return {
      error: "Não foi possível salvar a cota desta empresa. Tente novamente.",
    };
  revalidatePath("/admin/whatsapp");
  revalidatePath(`/painel/${companyId}/lembretes`);
  return {
    success: "Cota atualizada. O consumo já registrado foi preservado.",
  };
}
