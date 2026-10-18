"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  localAppointmentInstant,
  saoPauloDay,
  validDay,
} from "@/lib/scheduling";

export async function manageAppointment(form: FormData) {
  const input = z
    .object({
      company_id: z.uuid(),
      appointment_id: z.uuid(),
      operation: z.enum(["cancel", "reschedule", "complete"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/painel");
  const { company_id, appointment_id, operation } = input.data;
  const { db } = await requireCompany(company_id, true, true);
  const selectedDay = validDay(form.get("return_day"))
    ? String(form.get("return_day"))
    : saoPauloDay();
  const route = `/painel/${company_id}/agenda?day=${selectedDay}`;
  if (operation === "cancel" && form.get("confirm_cancel") !== "on")
    redirect(`${route}&erro=confirmacao`);
  const start =
    operation === "reschedule" && validDay(form.get("day"))
      ? localAppointmentInstant(
          String(form.get("day")),
          String(form.get("time")),
        )
      : null;
  if (operation === "reschedule" && !start) redirect(`${route}&erro=validacao`);
  const { error } = await db.rpc("manage_appointment", {
    p_company: company_id,
    p_appointment: appointment_id,
    p_action: operation,
    p_start: start,
  });
  if (error) redirect(`${route}&erro=alteracao`);
  revalidatePath(`/painel/${company_id}`, "layout");
  redirect(
    `/painel/${company_id}/agenda?day=${start ? saoPauloDay(new Date(start)) : selectedDay}&notice=${operation}`,
  );
}
