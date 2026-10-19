import { requireCompany } from "@/lib/auth";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PendingButton } from "@/components/pending-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { teamRoleLabels } from "@/lib/team";
import { assignProfessionalMember, invite, revokeMember } from "./actions";
import "../../operations.css";
import "./equipe.css";
type TeamMember = { user_id: string; role: string; email?: string | null };
type TeamProfessional = { id: string; name: string; user_id: string | null };
const errors: Record<string, string> = {
  convite:
    "Não foi possível criar o convite. Confira sua assinatura e permissões.",
  vinculo:
    "Não foi possível salvar o vínculo. Confira se a conta ainda faz parte da empresa e tente novamente.",
  "vinculo-atualizado":
    "Este vínculo mudou em outra aba. Atualize a página antes de tentar novamente.",
  "conta-vinculada":
    "Esta conta já está vinculada a outro profissional. Desvincule o acesso anterior antes de continuar.",
  confirmacao: "Confirme a alteração de acesso antes de continuar.",
  revogar:
    "Não foi possível revogar o acesso. Somente o proprietário pode remover gerentes ou colaboradores desta empresa. Atualize a página e tente novamente.",
};
export default async function Team({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ convite?: string; erro?: string; salvo?: string }>;
}) {
  const { companyId } = await params;
  const { db, role } = await requireCompany(companyId);
  const p = await searchParams;
  const [membersResult, professionalsResult] = await Promise.all([
    role === "OWNER"
      ? db.rpc("company_team_directory", { c: companyId })
      : db
          .from("memberships")
          .select("user_id,role")
          .eq("company_id", companyId),
    role === "OWNER"
      ? db
          .from("professionals")
          .select("id,name,user_id")
          .eq("company_id", companyId)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const members = (membersResult.data || []) as TeamMember[];
  const professionals = (professionalsResult.data || []) as TeamProfessional[];
  const error = membersResult.error || professionalsResult.error;
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
          {errors[p.erro] || errors.vinculo}
        </p>
      )}
      {["vinculo", "desvinculado", "revogado"].includes(p.salvo || "") ? (
        <p className="notice" role="status">
          {p.salvo === "vinculo"
            ? "Vínculo salvo. A conta já pode consultar a agenda atribuída a esse profissional."
            : p.salvo === "desvinculado"
              ? "Conta desvinculada. A agenda e o histórico do profissional foram preservados."
              : "Acesso revogado. O profissional, os clientes e os agendamentos foram preservados."}
        </p>
      ) : null}
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
                      {role === "OWNER"
                        ? m.email || "Conta sem e-mail disponível"
                        : "Sua conta"}
                    </strong>
                    <span>{teamRoleLabels[m.role] || m.role}</span>
                    {role === "OWNER" &&
                    m.role === "EMPLOYEE" &&
                    !professionals.some(
                      (person) => person.user_id === m.user_id,
                    ) ? (
                      <span className="team-unassigned-note">
                        Sem agenda vinculada — vincule abaixo
                      </span>
                    ) : null}
                  </div>
                  {role === "OWNER" && m.role !== "OWNER" ? (
                    <form action={revokeMember} className="team-revoke-form">
                      <input
                        type="hidden"
                        name="company_id"
                        value={companyId}
                      />
                      <input type="hidden" name="member_id" value={m.user_id} />
                      <ConfirmSubmit
                        label="Revogar acesso"
                        description={`A conta ${m.email || "selecionada"} perderá acesso a esta empresa. Os profissionais e agendamentos serão preservados. Convites pendentes para esse e-mail serão encerrados.`}
                      />
                    </form>
                  ) : (
                    <span className="team-role">
                      {teamRoleLabels[m.role] || m.role}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="team-access-note">
            <Icon name="calendar" size={18} />
            <p>
              {role === "OWNER"
                ? "Depois que o convite for aceito, vincule a conta ao profissional para liberar a agenda do colaborador."
                : "O proprietário vincula sua conta ao profissional para liberar a agenda atribuída. Gerentes consultam a agenda da empresa."}{" "}
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
      {role === "OWNER" ? (
        <section
          className="panel team-assignment-panel"
          id="vinculos"
          aria-labelledby="team-assignments-title"
        >
          <div className="team-assignment-heading">
            <span className="operations-icon">
              <Icon name="calendar" size={20} />
            </span>
            <div>
              <h2 id="team-assignments-title">Vincular contas à agenda</h2>
              <p>
                Associe cada profissional a uma conta que já aceitou o convite.
                Um colaborador vê somente os agendamentos e clientes do
                profissional vinculado.
              </p>
            </div>
          </div>
          {error ? (
            <p className="notice error" role="alert">
              Não foi possível carregar os vínculos. Atualize a página antes de
              alterar acessos.
            </p>
          ) : !professionals.length ? (
            <EmptyState
              icon="calendar"
              title="Cadastre seu primeiro profissional"
              description="O vínculo libera o acesso à agenda de um profissional já cadastrado."
            >
              <Link
                className="button"
                href={`/painel/${companyId}/professionals`}
              >
                Cadastrar profissional <Icon name="arrow-right" size={16} />
              </Link>
            </EmptyState>
          ) : (
            <div className="team-assignments">
              {professionals.map((professional) => {
                const currentMember = members.find(
                  (member) => member.user_id === professional.user_id,
                );
                return (
                  <form
                    action={assignProfessionalMember}
                    key={`${professional.id}:${professional.user_id || "none"}`}
                    className="team-assignment-card"
                  >
                    <input type="hidden" name="company_id" value={companyId} />
                    <input
                      type="hidden"
                      name="professional_id"
                      value={professional.id}
                    />
                    <input
                      type="hidden"
                      name="expected_member_id"
                      value={professional.user_id || ""}
                    />
                    <div className="team-professional-title">
                      <Icon name="user" size={18} />
                      <div>
                        <h3>{professional.name}</h3>
                        <p>
                          {professional.user_id
                            ? `Conta vinculada: ${currentMember?.email || "e-mail indisponível"}`
                            : "Nenhuma conta vinculada"}
                        </p>
                      </div>
                    </div>
                    <label htmlFor={`member-${professional.id}`}>
                      Quem acessa esta agenda?
                    </label>
                    <select
                      id={`member-${professional.id}`}
                      name="member_id"
                      defaultValue={professional.user_id || ""}
                    >
                      <option value="">Sem conta vinculada</option>
                      {members.map((member) => (
                        <option
                          key={member.user_id}
                          value={member.user_id}
                          disabled={professionals.some(
                            (person) =>
                              person.id !== professional.id &&
                              person.user_id === member.user_id,
                          )}
                        >
                          {member.email || "Conta sem e-mail disponível"} ·{" "}
                          {teamRoleLabels[member.role] || member.role}
                          {professionals.some(
                            (person) =>
                              person.id !== professional.id &&
                              person.user_id === member.user_id,
                          )
                            ? " · já vinculada"
                            : ""}
                        </option>
                      ))}
                    </select>
                    {professional.user_id ? (
                      <ConfirmSubmit
                        label="Alterar vínculo"
                        description={`Alterar ou remover o vínculo de ${professional.name} muda quais dados o colaborador pode consultar. O histórico da agenda será preservado.`}
                      />
                    ) : (
                      <PendingButton>
                        Vincular conta <Icon name="link" size={15} />
                      </PendingButton>
                    )}
                  </form>
                );
              })}
            </div>
          )}
          <p className="operations-field-note">
            <Icon name="shield" size={14} /> Cada conta pode ser vinculada a um
            único profissional por empresa. Este vínculo não cria colaboradores,
            não altera o plano e não envia convites.
          </p>
        </section>
      ) : null}
    </>
  );
}
