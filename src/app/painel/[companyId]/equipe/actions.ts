"use server";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  professionalMemberSchema,
  revokeMemberSchema,
  teamActionError,
} from "@/lib/team";
export async function invite(form: FormData) {
  const parsed = z
    .object({
      company_id: z.uuid(),
      email: z.email().max(254),
      role: z.enum(["MANAGER", "EMPLOYEE"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/painel");
  const { db, role } = await requireCompany(parsed.data.company_id, true);
  if (role !== "OWNER") redirect("/painel");
  const { data, error } = await db.rpc("invite_member", {
    c: parsed.data.company_id,
    e: parsed.data.email,
    r: parsed.data.role,
  });
  if (error) redirect(`/painel/${parsed.data.company_id}/equipe?erro=convite`);
  redirect(`/painel/${parsed.data.company_id}/equipe?convite=${data}`);
}

export async function assignProfessionalMember(form: FormData) {
  const parsed = professionalMemberSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/painel?erro=validacao");
  const input = parsed.data;
  const { db, role } = await requireCompany(input.company_id, true);
  if (role !== "OWNER") redirect(`/painel/${input.company_id}?erro=permissao`);
  const route = `/painel/${input.company_id}/equipe`;
  // Bound database state is checked again by the RPC; hidden values cannot bypass confirmation.
  const current = await db
    .from("professionals")
    .select("user_id,archived_at")
    .eq("company_id", input.company_id)
    .eq("id", input.professional_id)
    .single();
  if (current.error || !current.data) redirect(`${route}?erro=vinculo`);
  if (
    current.data.archived_at &&
    input.member_id &&
    input.member_id !== current.data.user_id
  )
    redirect(`${route}?erro=vinculo`);
  if (
    current.data.user_id &&
    current.data.user_id !== input.member_id &&
    input.confirm_action !== "yes"
  )
    redirect(`${route}?erro=confirmacao#vinculos`);
  const { error } = await db.rpc("assign_professional_member", {
    c: input.company_id,
    professional: input.professional_id,
    member: input.member_id,
    expected_member: input.expected_member_id,
    confirmed: input.confirm_action === "yes",
  });
  if (error)
    redirect(`${route}?erro=${teamActionError(error.message)}#vinculos`);
  revalidatePath(`/painel/${input.company_id}`, "layout");
  redirect(
    `${route}?salvo=${input.member_id ? "vinculo" : "desvinculado"}#vinculos`,
  );
}

export async function revokeMember(form: FormData) {
  const parsed = revokeMemberSchema.safeParse(Object.fromEntries(form));
  const company = z.uuid().safeParse(form.get("company_id"));
  if (!parsed.success)
    redirect(
      company.success
        ? `/painel/${company.data}/equipe?erro=confirmacao`
        : "/painel?erro=validacao",
    );
  const input = parsed.data;
  const { db, role } = await requireCompany(input.company_id);
  if (role !== "OWNER") redirect(`/painel/${input.company_id}?erro=permissao`);
  const { error } = await db.rpc("revoke_company_member", {
    c: input.company_id,
    member: input.member_id,
    confirmed: true,
  });
  if (error) redirect(`/painel/${input.company_id}/equipe?erro=revogar`);
  revalidatePath(`/painel/${input.company_id}`, "layout");
  redirect(`/painel/${input.company_id}/equipe?salvo=revogado`);
}
