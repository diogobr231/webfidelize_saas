import { requireCompany } from "@/lib/auth";
import { commercialPlans } from "@/lib/commercial";
import { hasAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { PlansComparison } from "@/components/plans-comparison";
export default async function Subscription({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { db, company, role } = await requireCompany(companyId, false, true);
  const [plans, professionals] = await Promise.all([
    commercialPlans(),
    db
      .from("professionals")
      .select("id", { head: true, count: "exact" })
      .eq("company_id", companyId)
      .is("archived_at", null),
  ]);
  const current = plans?.find((p) => p.id === company.plan_id);
  const labels: Record<string, string> = {
    active: "Ativa",
    past_due: "Pagamento pendente",
    suspended: "Suspensa",
    canceled: "Cancelada",
    trialing: hasAccess(company.status, company.trial_ends_at)
      ? "Teste gratuito"
      : "Teste encerrado",
  };
  return (
    <>
      <PageHeader
        eyebrow="Plano e acesso"
        title="Sua assinatura, com clareza."
        description="Consulte a situação atual da empresa e compare os planos. Alterações de acesso são confirmadas pelo backend."
      />
      <section
        className="panel billing-current"
        aria-label="Situação da assinatura"
      >
        <div>
          <p>Plano atual</p>
          <strong>{current?.name || "Consulta indisponível"}</strong>
          <small>
            {professionals.error || !current
              ? "Não foi possível consultar a utilização."
              : `${professionals.count ?? 0} de ${current.staff} profissionais ativos`}
          </small>
        </div>
        <div>
          <p>Situação</p>
          <strong>{labels[company.status] || "Consulta indisponível"}</strong>
          <small>
            {hasAccess(company.status, company.trial_ends_at)
              ? "Acesso às funções do seu perfil liberado."
              : "Alterações bloqueadas. Seus dados permanecem disponíveis para consulta."}
          </small>
        </div>
        <div>
          <p>Fim do teste desta empresa</p>
          <strong>
            {new Date(company.trial_ends_at).toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
          </strong>
          <small>Reabrir esta tela não renova o teste.</small>
        </div>
      </section>
      <PlansComparison
        plans={plans}
        current={company.plan_id}
        authenticated
        owner={role === "OWNER"}
      />
    </>
  );
}
