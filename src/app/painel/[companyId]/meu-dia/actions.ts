"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import { saoPauloDay, validDay } from "@/lib/scheduling";
import {
  parseMyStaffWhatsAppPreference,
  type WhatsAppFormState,
} from "@/lib/whatsapp-forms";

export async function saveMyWhatsAppPreference(
  companyId: string,
  _previous: WhatsAppFormState,
  form: FormData,
): Promise<WhatsAppFormState> {
  if (!z.uuid().safeParse(companyId).success) notFound();
  const input = parseMyStaffWhatsAppPreference(form);
  if (!input.success)
    return {
      error:
        "Informe seu WhatsApp com DDD e confirme a autorização para receber os avisos.",
    };
  // Opt-out remains available after expiry. The RPC derives the recipient from
  // auth.uid() and rechecks membership and the active professional linkage.
  const { db } = await requireCompany(companyId, input.data.enabled);
  const { error } = await db.rpc("save_my_whatsapp_staff_preferences", {
    p_company: companyId,
    p_phone: input.data.phone,
    p_enabled: input.data.enabled,
  });
  if (error)
    return {
      error:
        "Não foi possível atualizar sua preferência. Confira seu vínculo e tente novamente.",
    };
  revalidatePath(`/painel/${companyId}/meu-dia`);
  return {
    success: input.data.enabled
      ? "Seu WhatsApp foi autorizado. Os avisos seguem as preferências da empresa e dependem da conexão e da cota disponível."
      : "Autorização revogada. Novos avisos da equipe não serão enviados para você.",
  };
}

export async function completeMyAppointment(companyId: string, form: FormData) {
  const { db, role } = await requireCompany(companyId, true);
  const day = validDay(form.get("day"))
    ? String(form.get("day"))
    : saoPauloDay();
  const target = `/painel/${companyId}/meu-dia?${new URLSearchParams({ day })}`;
  const appointment = z.uuid().safeParse(form.get("appointment_id"));
  if (
    role !== "EMPLOYEE" ||
    !appointment.success ||
    form.get("confirm_action") !== "yes"
  )
    redirect(`${target}&erro=permissao`);
  // The RPC rechecks membership, active linkage, company access and ended status.
  const { error } = await db.rpc("complete_my_appointment", {
    p_company: companyId,
    p_appointment: appointment.data,
  });
  if (error) redirect(`${target}&erro=conclusao`);
  revalidatePath(`/painel/${companyId}`, "layout");
  redirect(`${target}&salvo=concluido`);
}
