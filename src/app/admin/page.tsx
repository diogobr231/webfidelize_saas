import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { AdminNavigation } from "@/components/admin/navigation";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { niches } from "@/lib/catalog";
import { manageCompany } from "./actions";
import { commercialPlans } from "@/lib/commercial";
import { operationsSummarySchema } from "@/lib/admin-operations";
import { OperationsOverview } from "@/components/admin-operations/overview";
import "./admin.css";
import "./automacoes/operations.css";
export const dynamic = "force-dynamic";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; salvo?: string; empresa?: string }>;
}) {
  const feedback = await searchParams;
  const { db } = await requireUser();
  const { data: admin, error: authError } = await db.rpc("is_super_admin");
  if (authError || !admin) notFound();
  const selectedId = z.uuid().safeParse(feedback.empresa);
  const [companiesResult, summaryResult, plans, selectedResult] =
    await Promise.all([
      db
        .from("companies")
        .select(
          "id,name,niche,status,trial_ends_at,plan_id,trial_card_required",
        )
        .order("created_at", { ascending: false })
        .limit(12),
      db.rpc("admin_operations_summary"),
      commercialPlans(),
      selectedId.success
        ? db
            .from("companies")
            .select(
              "id,name,niche,status,trial_ends_at,plan_id,trial_card_required",
            )
            .eq("id", selectedId.data)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  const companies = [...(companiesResult.data ?? [])];
  const selectedCompany = selectedResult.data;
  if (
    selectedCompany &&
    !companies.some((company) => company.id === selectedCompany.id)
  )
    companies.push(selectedCompany);
  const error = companiesResult.error || selectedResult.error;
  const parsedSummary = !summaryResult.error
    ? operationsSummarySchema.safeParse(summaryResult.data)
    : null;
  const summary = parsedSummary?.success ? parsedSummary.data : null;
  return (
    <main className="admin-shell">
      <AdminNavigation current="overview" />
      <div className="admin-content">
        {feedback.erro && (
          <p role="alert" className="notice error">
            {feedback.erro === "cartao"
              ? "Este cadastro mantém uma restrição de ativação no backend. Confira o diagnóstico da empresa antes de alterar o acesso."
              : "Não foi possível aplicar a alteração. Confira os valores, permissões e confirme a operação."}
          </p>
        )}
        {feedback.salvo === "1" && !feedback.erro && (
          <p role="status" className="notice">
            Configuração da empresa atualizada.
          </p>
        )}
        <PageHeader
          eyebrow="Central de gestão"
          title="Sua plataforma, em uma visão."
          description="Gerencie empresas, vendas e atendimento."
        />
        <OperationsOverview summary={summary} plans={plans} />
        {selectedId.success &&
          !selectedResult.error &&
          !selectedResult.data && (
            <p role="alert" className="notice error">
              A empresa vinculada não foi localizada. Consulte os espaços
              disponíveis abaixo.
            </p>
          )}
        <div className="admin-billing-note">
          <Icon name="shield" size={20} />
          <div>
            <strong>Recebimentos: homologação pendente</strong>
            <p>Configure e valide os pagamentos antes de liberar cobranças.</p>
            <Link href="/admin/integracoes#payments" className="ops-text-link">
              <Icon name="settings" size={15} /> Ver requisitos e taxas
            </Link>
            <details>
              <summary>Teste gratuito e renovação</summary>
              <p>
                Novas empresas recebem 7 dias grátis sem cartão, com prazo
                controlado no backend. Pix e cartão estão implementados e
                aguardam a validação externa do Mercado Pago antes de habilitar
                cobranças. Não é possível liberar uma assinatura paga
                manualmente.
              </p>
              <p>
                Suspender ou cancelar o acesso de uma empresa não cancela a
                renovação no Mercado Pago. O proprietário gerencia a recorrência
                em Plano e assinatura; consulte o histórico no diagnóstico da
                empresa antes de orientar uma regularização.
              </p>
            </details>
          </div>
        </div>
        {error ? (
          <p role="alert" className="notice error">
            Não foi possível carregar as empresas.
          </p>
        ) : (
          <section className="panel admin-companies" id="empresas">
            <div className="admin-section-heading">
              <div>
                <h2>Empresas recentes</h2>
                <p>
                  Até 12 empresas recentes
                  {selectedResult.data
                    ? ", além da empresa selecionada, quando necessário"
                    : ""}
                  .
                </p>
              </div>
              <Link className="button secondary" href="/admin/espacos">
                <Icon name="building" size={16} /> Ver todas
              </Link>
            </div>
            {companies?.length ? (
              <div className="table-wrap">
                <table className="admin-companies-table">
                  <caption className="sr-only">
                    Empresas cadastradas, situação de acesso e data final do
                    teste
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Empresa</th>
                      <th scope="col">Segmento</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Fim do teste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies?.map((c) => (
                      <tr key={c.id} id={`empresa-${c.id}`}>
                        <td data-label="Empresa">
                          <Link
                            className="button secondary"
                            href={`/admin/empresas/${c.id}`}
                          >
                            Diagnóstico de acesso
                          </Link>
                          <div className="admin-company-name">
                            <span
                              className="admin-company-avatar"
                              aria-hidden="true"
                            >
                              <Icon name="building" size={18} />
                            </span>
                            <strong>{c.name}</strong>
                          </div>
                          <details className="admin-company-controls">
                            <summary>
                              <Icon name="settings" size={14} /> Gerenciar
                              empresa
                            </summary>
                            <form
                              action={manageCompany}
                              className="admin-manage-form"
                            >
                              <input type="hidden" name="c" value={c.id} />
                              <label>
                                Plano
                                <select
                                  name="new_plan"
                                  defaultValue={c.plan_id}
                                >
                                  <option value="essencial">Essencial</option>
                                  <option value="profissional">
                                    Profissional
                                  </option>
                                  <option value="empresarial">
                                    Empresarial
                                  </option>
                                </select>
                              </label>
                              <label>
                                Status manual
                                <select
                                  name="new_status"
                                  required
                                  defaultValue={
                                    [
                                      c.trial_card_required
                                        ? "pending_card"
                                        : "trialing",
                                      "suspended",
                                      "canceled",
                                    ].includes(c.status)
                                      ? c.status
                                      : ""
                                  }
                                >
                                  <option value="" disabled>
                                    Selecione a situação
                                  </option>
                                  {c.trial_card_required ? (
                                    <option value="pending_card">
                                      Aguardando cartão
                                    </option>
                                  ) : (
                                    <option value="trialing">Em teste</option>
                                  )}
                                  <option value="suspended">Suspenso</option>
                                  <option value="canceled">Cancelado</option>
                                </select>
                              </label>
                              {c.trial_card_required ? (
                                <>
                                  <input
                                    type="hidden"
                                    name="new_trial"
                                    value=""
                                  />
                                  <p className="muted">
                                    Teste aguardando autorização do cartão. O
                                    prazo não é iniciado por este formulário.
                                  </p>
                                </>
                              ) : (
                                <label>
                                  Fim do trial (ISO com fuso)
                                  <input
                                    name="new_trial"
                                    defaultValue={c.trial_ends_at ?? ""}
                                    required
                                  />
                                </label>
                              )}
                              <ConfirmSubmit
                                label="Aplicar alteração"
                                description={`Esta operação altera o plano, a situação e o prazo de teste de ${c.name}. Suspender ou cancelar bloqueia alterações na empresa. Confira os campos antes de confirmar.`}
                              />
                            </form>
                          </details>
                        </td>
                        <td data-label="Segmento">
                          {niches.find((niche) => niche.slug === c.niche)
                            ?.name || c.niche}
                        </td>
                        <td data-label="Situação">
                          <span
                            className={`admin-status admin-status-${c.status}`}
                          >
                            {(
                              {
                                pending_card: "Aguardando cartão",
                                trialing:
                                  c.trial_ends_at &&
                                  Date.parse(c.trial_ends_at) <= Date.now()
                                    ? "Teste encerrado"
                                    : "Em teste",
                                active: "Ativa",
                                past_due: "Pagamento pendente",
                                suspended: "Suspensa",
                                canceled: "Cancelada",
                              } as Record<string, string>
                            )[c.status] || c.status}
                          </span>
                        </td>
                        <td data-label="Fim do teste">
                          {c.trial_ends_at
                            ? new Date(c.trial_ends_at).toLocaleDateString(
                                "pt-BR",
                                {
                                  timeZone: "America/Sao_Paulo",
                                },
                              )
                            : "Não iniciado"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="building"
                title="Nenhuma empresa cadastrada"
                description="Os novos espaços aparecerão aqui quando seus proprietários concluírem o cadastro da empresa."
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}
