import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Brand } from "@/components/ui/brand";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { niches } from "@/lib/catalog";
import { manageCompany } from "./actions";
import "./admin.css";
export const dynamic = "force-dynamic";
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; salvo?: string }>;
}) {
  const feedback = await searchParams;
  const { db } = await requireUser();
  const { data: admin, error: authError } = await db.rpc("is_super_admin");
  if (authError || !admin) notFound();
  const { data: companies, error } = await db
    .from("companies")
    .select("id,name,niche,status,trial_ends_at,plan_id")
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <main className="admin-shell">
      <nav className="admin-topbar" aria-label="Administração da plataforma">
        <Brand href="/painel" />
        <div className="admin-topbar-actions">
          <Link className="button secondary" href="/admin/comercial">
            Central comercial
          </Link>
          <Link className="button secondary" href="/admin/ajuda">
            Ajuda e solicitações
          </Link>
          <span className="admin-access">
            <Icon name="shield" size={14} /> SUPER_ADMIN
          </span>
          <Link className="button secondary" href="/painel?empresas=1">
            Ver espaços <Icon name="arrow-up-right" size={16} />
          </Link>
        </div>
      </nav>
      <div className="admin-content">
        {feedback.erro && (
          <p role="alert" className="notice error">
            Não foi possível aplicar a alteração. Confira os valores, permissões
            e confirme a operação.
          </p>
        )}
        {feedback.salvo === "1" && !feedback.erro && (
          <p role="status" className="notice">
            Configuração da empresa atualizada.
          </p>
        )}
        <PageHeader
          eyebrow="Visão administrativa"
          title="Empresas da plataforma"
          description="Acompanhe os espaços cadastrados e gerencie planos, acesso e períodos de teste."
        />
        <div className="admin-billing-note">
          <Icon name="shield" size={20} />
          <div>
            <strong>Ativação paga em preparação</strong>
            <p>
              A ativação de assinaturas depende da conciliação Mercado Pago,
              ainda pendente. Aqui você pode administrar empresas e trials.
            </p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="notice error">
            Não foi possível carregar as empresas.
          </p>
        ) : (
          <section className="panel admin-companies">
            <div className="admin-section-heading">
              <div>
                <h2>Todos os espaços</h2>
                <p>Até 100 empresas mais recentes da plataforma.</p>
              </div>
              <span className="admin-count">
                {companies?.length ?? 0} nesta lista
              </span>
            </div>
            {companies?.length ? (
              <div className="table-wrap">
                <table>
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
                      <tr key={c.id}>
                        <td>
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
                                <select name="new_status">
                                  <option value="trialing">Trial</option>
                                  <option value="suspended">Suspenso</option>
                                  <option value="canceled">Cancelado</option>
                                </select>
                              </label>
                              <label>
                                Fim do trial (ISO com fuso)
                                <input
                                  name="new_trial"
                                  defaultValue={c.trial_ends_at}
                                  required
                                />
                              </label>
                              <ConfirmSubmit
                                label="Aplicar alteração"
                                description={`Esta operação altera o plano, a situação e o prazo de teste de ${c.name}. Suspender ou cancelar bloqueia alterações na empresa. Confira os campos antes de confirmar.`}
                              />
                            </form>
                          </details>
                        </td>
                        <td>
                          {niches.find((niche) => niche.slug === c.niche)
                            ?.name || c.niche}
                        </td>
                        <td>
                          <span
                            className={`admin-status admin-status-${c.status}`}
                          >
                            {(
                              {
                                trialing: "Em teste",
                                active: "Ativa",
                                past_due: "Pagamento pendente",
                                suspended: "Suspensa",
                                canceled: "Cancelada",
                              } as Record<string, string>
                            )[c.status] || c.status}
                          </span>
                        </td>
                        <td>
                          {new Date(c.trial_ends_at).toLocaleDateString(
                            "pt-BR",
                            {
                              timeZone: "America/Sao_Paulo",
                            },
                          )}
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
