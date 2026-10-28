"use server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
export async function manageCompany(form: FormData) {
  const { db } = await requireUser();
  const { data: admin } = await db.rpc("is_super_admin");
  if (!admin) notFound();
  if (form.get("confirm_action") !== "yes") redirect("/admin?erro=confirmacao");
  const input = z
    .object({
      c: z.uuid(),
      new_plan: z.enum(["essencial", "profissional", "empresarial"]),
      new_status: z.enum(["pending_card", "trialing", "suspended", "canceled"]),
      new_trial: z.preprocess(
        (value) => (value === "" ? null : value),
        z.iso.datetime({ offset: true }).nullable(),
      ),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/admin?erro=validacao");
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("trial_card_required")
    .eq("id", input.data.c)
    .single();
  if (companyError || !company) redirect("/admin?erro=alteracao");
  if (
    company.trial_card_required &&
    (input.data.new_status === "trialing" || input.data.new_trial !== null)
  ) {
    redirect("/admin?erro=cartao");
  }
  if (
    !company.trial_card_required &&
    (input.data.new_status === "pending_card" || input.data.new_trial === null)
  ) {
    redirect("/admin?erro=validacao");
  }
  const { error } = await db.rpc("admin_company", input.data);
  if (error) redirect("/admin?erro=alteracao");
  revalidatePath("/admin");
  redirect("/admin?salvo=1");
}
