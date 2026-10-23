import { requireCompany } from "@/lib/auth";
import { commercialPlans } from "@/lib/commercial";
import { hasAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { PlansComparison } from "@/components/plans-comparison";
import { niches } from "@/lib/catalog";
import Link from "next/link";
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
    pending_card: "Ativação do teste pendente",
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
      {company.status === "pending_card" && (
        <section className="panel" aria-labelledby="trial-activation-title">
          <p className="notice" role="status">
            Conta criada e acesso realizado com sucesso. Falta ativar o período
            de teste da empresa.
          </p>
          <h2 id="trial-activation-title">Ativação do teste pendente</h2>
          <p>
            Sua empresa foi cadastrada, mas ainda consta com a ativação
            pendente. A oferta atual permite 7 dias sem cartão. Fale com o
            suporte para verificar este cadastro; nenhuma cobrança foi iniciada.
          </p>
          <p>
            {role === "OWNER"
              ? "Seus dados estão salvos. O suporte pode consultar o diagnóstico de acesso da empresa."
              : "O proprietário da empresa pode solicitar a verificação do acesso."}
          </p>
          <a
            className="button secondary"
            href="https://wa.me/5518997695445"
            target="_blank"
            rel="noreferrer"
          >
            Falar sobre a ativação
          </a>
          {niches.some((niche) => niche.slug === company.niche) && (
            <p>
              <Link
                className="button secondary"
                href={`/demonstracao/${company.niche}`}
              >
                Explorar a demonstração enquanto aguardo
              </Link>
            </p>
          )}
        </section>
      )}
      {company.status === "trialing" &&
        company.trial_card_required === false && (
          <p className="notice">
            Este teste não exige cartão e não gera cobrança automática. Confira
            abaixo o prazo registrado para sua empresa. Ao terminar, as
            alterações ficam bloqueadas e seus dados permanecem disponíveis para
            consulta.
          </p>
        )}
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
            {company.trial_ends_at
              ? new Date(company.trial_ends_at).toLocaleDateString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })
              : "Ainda não iniciado"}
          </strong>
          <small>
            {company.status === "pending_card"
              ? "Fale com o suporte para verificar a ativação deste cadastro."
              : "Reabrir esta tela não renova o teste."}
          </small>
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
