import { requireCompany } from "@/lib/auth";
import { commercialPlans } from "@/lib/commercial";
import { hasAccess } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { PlansComparison } from "@/components/plans-comparison";
import { money, niches } from "@/lib/catalog";
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
            Sua empresa foi cadastrada. Para liberar os 7 dias de teste, é
            obrigatório cadastrar e autorizar um cartão no ambiente seguro do
            Mercado Pago. Esta integração ainda está em configuração; seu
            período de teste não começou.
          </p>
          <p>
            A primeira mensalidade será cobrada somente após os 7 dias, com
            renovação mensal
            {current
              ? ` de ${money(current.cents)} no plano ${current.name}`
              : " pelo valor do plano contratado"}
            . Cancelar antes do fim do teste evita a primeira cobrança. O prazo
            e as condições serão apresentados na ativação.
          </p>
          <p>
            O provedor pode realizar uma validação temporária do cartão,
            conforme as condições informadas no ambiente de pagamento. Essa
            validação não é a primeira mensalidade.
          </p>
          <p>
            {role === "OWNER"
              ? "O cadastro do cartão será realizado pelo proprietário quando a integração estiver disponível. Sua conta permanece salva e nenhuma cobrança foi iniciada por este cadastro."
              : "A ativação é responsabilidade do proprietário da empresa. Colaboradores convidados não precisam cadastrar cartão."}
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
            Seu teste já existente mantém o prazo e as condições anteriores. A
            exigência de cartão se aplica à ativação de novos testes.
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
              ? "Os 7 dias começam após a confirmação segura do cartão."
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
