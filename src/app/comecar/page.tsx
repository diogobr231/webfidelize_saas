import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/auth/actions";
import { OnboardingFrame } from "@/components/onboarding/frame";
import { CompanySetupForm } from "@/components/onboarding/forms";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";

export default async function Start() {
  const { db, user } = await requireUser();
  const [admin, ownership] = await Promise.all([
    db.rpc("is_super_admin"),
    db
      .from("memberships")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("role", "OWNER")
      .maybeSingle(),
  ]);
  if (!admin.error && admin.data) redirect("/admin");
  if (!ownership.error && ownership.data) {
    const { data: company, error } = await db
      .from("companies")
      .select("status")
      .eq("id", ownership.data.company_id)
      .single();
    if (error) redirect("/painel?empresas=1&erro=consulta");
    redirect(
      `/painel/${ownership.data.company_id}/${company.status === "pending_card" ? "assinatura" : "configuracao"}`,
    );
  }
  return (
    <main className="onb-entry">
      <nav aria-label="Conta">
        <Brand href="/" />
        <form action={logout}>
          <button className="secondary">
            <Icon name="logout" size={16} />
            Sair
          </button>
        </form>
      </nav>
      {admin.error || ownership.error ? (
        <section className="panel">
          <h1>Vamos retomar em instantes.</h1>
          <p role="alert">
            Não foi possível consultar sua conta. Nenhuma empresa foi criada.
          </p>
          <Link className="button" href="/comecar">
            Tentar novamente
          </Link>
        </section>
      ) : (
        <OnboardingFrame current="empresa" services={0} professionals={0}>
          <CompanySetupForm />
        </OnboardingFrame>
      )}
    </main>
  );
}
