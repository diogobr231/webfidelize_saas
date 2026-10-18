import { requireCompany } from "@/lib/auth";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PendingButton } from "@/components/pending-button";
import { invite } from "./actions";
import "../../operations.css";
export default async function Team({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ convite?: string; erro?: string }>;
}) {
  const { companyId } = await params;
  const { db, role } = await requireCompany(companyId);
  const p = await searchParams;
  const { data: members, error } = await db
    .from("memberships")
    .select("user_id,role")
    .eq("company_id", companyId);
  return (
    <>
      <PageHeader
        eyebrow="Seu time, bem organizado"
        title="Equipe e permissões"
        description="Gerencie quem acessa o sistema e o que cada pessoa pode fazer."
        action={
          role === "OWNER" ? (
            <a className="button" href="#convidar-colaborador">
              <Icon name="plus" size={16} /> Convidar colaborador
            </a>
          ) : undefined
        }
      />
      {error && (
        <p role="alert" className="notice error">
          Não foi possível carregar a equipe.
        </p>
      )}
      {p.erro && (
        <p role="alert" className="notice error">
          Não foi possível criar o convite. Confira sua assinatura e permissões.
        </p>
      )}
      {p.convite && /^[a-f0-9]{64}$/.test(p.convite) && role === "OWNER" && (
        <div className="notice team-invite-result" role="status">
          <Icon name="link" size={20} />
          <div>
            <strong>
              Convite gerado. Compartilhe somente com o destinatário.
            </strong>
            <p className="team-invite-url">
              {process.env.APP_URL}/convite/{p.convite}
            </p>
            Válido por 48 horas. O destinatário precisa confirmar o e-mail e
            entrar na conta antes de aceitar.
          </div>
        </div>
      )}
      <div className={`records-layout${role === "OWNER" ? " has-editor" : ""}`}>
        <section className="panel records-list">
          <div className="records-list-heading">
            <div>
              <span className="operations-icon">
                <Icon name="users" size={18} />
              </span>
              <h2>Acessos ao sistema</h2>
            </div>
            <span className="operations-count">
              {members?.length ?? 0} acessíveis
            </span>
          </div>
          {!members?.length ? (
            <EmptyState
              icon="users"
              title={
                error ? "Equipe indisponível" : "Nenhum vínculo disponível"
              }
              description={
                error
                  ? "Atualize a página para tentar novamente."
                  : "Os usuários que você pode consultar aparecerão aqui."
              }
            />
          ) : (
            <ul className="team-members">
              {members.map((m) => (
                <li key={m.user_id}>
                  <span className="team-member-avatar" aria-hidden="true">
                    <Icon
                      name={m.role === "OWNER" ? "shield" : "user"}
                      size={20}
                    />
                  </span>
                  <div className="team-member-info">
                    <strong>
                      {(
                        {
                          OWNER: "Proprietário",
                          MANAGER: "Gerente",
                          EMPLOYEE: "Colaborador",
                        } as Record<string, string>
                      )[m.role] || m.role}
                    </strong>
                    <span>Identificador do usuário</span>
                    <code>{m.user_id}</code>
                  </div>
                  <span className="team-role">{m.role}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="team-access-note">
            <Icon name="calendar" size={18} />
            <p>
              Profissional na agenda e acesso ao sistema são cadastros
              separados.{" "}
              <Link href={`/painel/${companyId}/professionals`}>
                Ver profissionais <Icon name="arrow-up-right" size={13} />
              </Link>
            </p>
          </div>
        </section>
        {role === "OWNER" && (
          <section className="panel record-editor" id="convidar-colaborador">
            <span className="operations-icon">
              <Icon name="mail" size={18} />
            </span>
            <h2>Convidar colaborador</h2>
            <p>
              Gere um link individual e compartilhe com quem vai participar da
              sua equipe.
            </p>
            <form action={invite} className="operations-form">
              <input name="company_id" type="hidden" value={companyId} />
              <label htmlFor="email">E-mail do colaborador</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="nome@empresa.com"
                autoComplete="email"
                required
              />
              <label htmlFor="role">Permissão</label>
              <select id="role" name="role">
                <option value="EMPLOYEE">
                  Colaborador: agenda atribuída e clientes relacionados
                </option>
                <option value="MANAGER">
                  Gerente: cadastros e agenda da empresa
                </option>
              </select>
              <p className="operations-field-note">
                <Icon name="shield" size={14} /> O convite permite um único
                aceite e expira em 48 horas.
              </p>
              <PendingButton>
                Gerar convite de uso único <Icon name="arrow-right" size={16} />
              </PendingButton>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
