"use server";
import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getAuthOrigin } from "@/lib/auth-origin";
import { sendTeamInvitation } from "@/lib/team-mail";
import {
  cancelInvitationSchema,
  createInvitationSchema,
  existingInvitationSchema,
  invitationError,
  professionalMemberSchema,
  revokeMemberSchema,
  teamActionError,
  teamInvitationIssueSchema,
  type InvitationActionState,
} from "@/lib/team";
export async function invite(
  _previous: InvitationActionState,
  form: FormData,
): Promise<InvitationActionState> {
  const parsed = createInvitationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "convite" };
  let origin: string;
  try {
    origin = getAuthOrigin();
  } catch {
    return { error: "convite" };
  }
  const { db, role } = await requireCompany(parsed.data.company_id, true);
  if (role !== "OWNER") redirect("/painel");
  const { data, error } = await db.rpc("create_team_invitation", {
    p_company: parsed.data.company_id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) return { error: invitationError(error.message) };
  const issue = teamInvitationIssueSchema.safeParse(data);
  if (!issue.success) return { error: "convite" };
  revalidatePath(`/painel/${parsed.data.company_id}/equipe`);
  // The token is returned in this private POST result, never a panel query string.
  const delivery =
    form.get("send_email") === "yes"
      ? await sendTeamInvitation(issue.data)
      : "not_requested";
  return {
    issue: issue.data,
    url: `${origin}/convite/${issue.data.token}`,
    delivery,
  };
}

export async function resendInvitation(
  _previous: InvitationActionState,
  form: FormData,
): Promise<InvitationActionState> {
  const parsed = existingInvitationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "convite" };
  let origin: string;
  try {
    origin = getAuthOrigin();
  } catch {
    return { error: "convite" };
  }
  const { db, role } = await requireCompany(parsed.data.company_id, true);
  if (role !== "OWNER") redirect("/painel");
  const { data, error } = await db.rpc("resend_team_invitation", {
    p_company: parsed.data.company_id,
    p_invitation: parsed.data.invitation_id,
  });
  if (error) return { error: invitationError(error.message) };
  const issue = teamInvitationIssueSchema.safeParse(data);
  if (!issue.success) return { error: "convite" };
  revalidatePath(`/painel/${parsed.data.company_id}/equipe`);
  const delivery =
    form.get("send_email") === "yes"
      ? await sendTeamInvitation(issue.data)
      : "not_requested";
  return {
    issue: issue.data,
    url: `${origin}/convite/${issue.data.token}`,
    delivery,
  };
}

export async function cancelInvitation(form: FormData) {
  const parsed = cancelInvitationSchema.safeParse(Object.fromEntries(form));
  const company = z.uuid().safeParse(form.get("company_id"));
  if (!parsed.success)
    redirect(
      company.success
        ? `/painel/${company.data}/equipe?erro=confirmacao#convites`
        : "/painel?erro=validacao",
    );
  const { db, role } = await requireCompany(parsed.data.company_id);
  if (role !== "OWNER")
    redirect(`/painel/${parsed.data.company_id}?erro=permissao`);
  const { error } = await db.rpc("cancel_team_invitation", {
    p_company: parsed.data.company_id,
    p_invitation: parsed.data.invitation_id,
    p_confirmed: true,
  });
  if (error)
    redirect(
      `/painel/${parsed.data.company_id}/equipe?erro=${invitationError(error.message)}#convites`,
    );
  revalidatePath(`/painel/${parsed.data.company_id}/equipe`);
  redirect(
    `/painel/${parsed.data.company_id}/equipe?salvo=convite-cancelado#convites`,
  );
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
