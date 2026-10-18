"use server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
export async function manageCompany(form: FormData) {
  const { db } = await requireUser();
  const { data: admin } = await db.rpc("is_super_admin");
  if (!admin) notFound();
  const input = z
    .object({
      c: z.uuid(),
      new_plan: z.enum(["essencial", "profissional", "empresarial"]),
      new_status: z.enum(["trialing", "suspended", "canceled"]),
      new_trial: z.iso.datetime({ offset: true }),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) redirect("/admin?erro=validacao");
  const { error } = await db.rpc("admin_company", input.data);
  if (error) redirect("/admin?erro=alteracao");
  revalidatePath("/admin");
  redirect("/admin");
}
