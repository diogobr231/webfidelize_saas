import "server-only";
import { redirect } from "next/navigation";
import { createClient, configured } from "./supabase/server";
import { canManage, hasAccess, type Role } from "./permissions";
export async function requireUser() {
  if (!configured()) redirect("/entrar?erro=configuracao");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/entrar");
  return { db, user };
}
export async function requireCompany(
  companyId: string,
  write = false,
  management = false,
) {
  const { db, user } = await requireUser();
  const { data: member } = await db
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .single();
  if (!member) redirect("/painel?erro=acesso");
  const { data: company } = await db
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();
  if (!company) redirect("/painel?erro=acesso");
  if (management && !canManage(member.role as Role))
    redirect(`/painel/${companyId}?erro=permissao`);
  if (write && !hasAccess(company.status, company.trial_ends_at))
    redirect(`/painel/${companyId}?erro=assinatura`);
  return { db, user, company, role: member.role as Role };
}
