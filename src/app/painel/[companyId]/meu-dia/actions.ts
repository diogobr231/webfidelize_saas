"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import { saoPauloDay, validDay } from "@/lib/scheduling";

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
