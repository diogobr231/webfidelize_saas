import { requireCompany } from "@/lib/auth";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PendingButton } from "@/components/pending-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import {
  INVITATION_PAGE_SIZE,
  invitationErrorMessages,
  invitationPage,
  invitationStatus,
  teamRoleLabels,
} from "@/lib/team";
import {
  assignProfessionalMember,
  cancelInvitation,
  revokeMember,
} from "./actions";
import { InvitationForm, InvitationRenewal } from "./invitation-form";
import { invitationEmailEnabled } from "@/lib/team-mail";
import "../../operations.css";
import "./equipe.css";
type TeamMember = { user_id: string; role: string; email?: string | null };
type TeamProfessional = {
  id: string;
  name: string;
  user_id: string | null;
  archived_at: string | null;
};
type TeamInvitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  canceled_at: string | null;
  last_issued_at: string;
  created_at: string;
};
const errors: Record<string, string> = {
  ...invitationErrorMessages,
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
  searchParams: Promise<{
    erro?: string;
    salvo?: string;
    pagina?: string;
    convites?: string;
  }>;
}) {
  const { companyId } = await params;
  const { db, role, company } = await requireCompany(companyId);
  const deliveryEnabled = role === "OWNER" && invitationEmailEnabled();
  const p = await searchParams;
  const allInvitations = p.convites === "todos";
  const requestedPage = invitationPage(p.pagina);
  const invitationsQuery = (page: number) => {
    let query = db
      .from("invitations")
      .select(
        "id,email,role,expires_at,accepted_at,canceled_at,last_issued_at,created_at",
        { count: "exact" },
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (!allInvitations)
      query = query.is("accepted_at", null).is("canceled_at", null);
    return query.range(
      (page - 1) * INVITATION_PAGE_SIZE,
      page * INVITATION_PAGE_SIZE - 1,
    );
  };
  const [membersResult, professionalsResult, firstInvitations, planResult] =
    await Promise.all([
      role === "OWNER"
        ? db.rpc("company_team_directory", { c: companyId })
        : db
            .from("memberships")
            .select("user_id,role")
            .eq("company_id", companyId),
      role === "OWNER"
        ? db
            .from("professionals")
            .select("id,name,user_id,archived_at")
            .eq("company_id", companyId)
            .order("name")
        : Promise.resolve({ data: [], error: null }),
      role === "OWNER"
        ? invitationsQuery(requestedPage)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      role === "OWNER"
        ? db
            .from("plans")
            .select("staff_limit")
            .eq("id", company.plan_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);
  const members = (membersResult.data || []) as TeamMember[];
  const professionals = (professionalsResult.data || []) as TeamProfessional[];
  const error = membersResult.error || professionalsResult.error;
  const pages = Math.max(
    1,
    Math.ceil((firstInvitations.count || 0) / INVITATION_PAGE_SIZE),
  );
  const currentPage = Math.min(requestedPage, pages);
  const invitationsResult =
    role === "OWNER" && !firstInvitations.error && currentPage !== requestedPage
      ? await invitationsQuery(currentPage)
      : firstInvitations;
  const invitations = (invitationsResult.data || []) as TeamInvitation[];
  const invitationUrl = (page: number, all = allInvitations) =>
    `/painel/${companyId}/equipe?convites=${all ? "todos" : "abertos"}&pagina=${page}#convites`;
  const dateLabel = (value: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
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
      {["vinculo", "desvinculado", "revogado", "convite-cancelado"].includes(
        p.salvo || "",
      ) ? (
        <p className="notice" role="status">
          {p.salvo === "vinculo"
            ? "Vínculo salvo. A conta já pode consultar a agenda atribuída a esse profissional."
            : p.salvo === "desvinculado"
              ? "Conta desvinculada. A agenda e o histórico do profissional foram preservados."
              : p.salvo === "convite-cancelado"
                ? "Convite cancelado. O link não permite mais entrar na empresa."
                : "Acesso revogado. O profissional, os clientes e os agendamentos foram preservados."}
        </p>
      ) : null}
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
            {planResult.data && !membersResult.error ? (
              <p className="operations-field-note">
                {members.filter((member) => member.role !== "OWNER").length} de{" "}
                {planResult.data.staff_limit} acessos de colaboradores
                utilizados. O acesso do proprietário não entra nessa contagem.
              </p>
            ) : null}
            <InvitationForm
              companyId={companyId}
              deliveryEnabled={deliveryEnabled}
            />
          </section>
        )}
      </div>
      {role === "OWNER" ? (
        <section
          className="panel team-invitations-panel"
          id="convites"
          aria-labelledby="team-invitations-title"
        >
          <div className="team-assignment-heading">
            <Icon name="mail" size={20} />
            <div>
              <h2 id="team-invitations-title">Convites da equipe</h2>
              <p>
                Renove um link expirado ou cancele um convite enviado por
                engano. Um novo link mantém o destinatário e a permissão, e
                invalida o anterior.
              </p>
            </div>
          </div>
          <nav
            className="team-invitation-filters"
            aria-label="Filtrar convites"
          >
            <Link
              href={invitationUrl(1, false)}
              aria-current={!allInvitations ? "page" : undefined}
            >
              Em aberto e expirados
            </Link>
            <Link
              href={invitationUrl(1, true)}
              aria-current={allInvitations ? "page" : undefined}
            >
              Todos os convites
            </Link>
          </nav>
          {invitationsResult.error ? (
            <p className="notice error" role="alert">
              Não foi possível carregar os convites. Atualize a página para
              tentar novamente.
            </p>
          ) : !invitations.length ? (
            <EmptyState
              icon="mail"
              title="Nenhum convite nesta lista"
              description="Convites gerados para a sua empresa aparecerão aqui com sua validade e situação."
            />
          ) : (
            <ul className="team-invitations">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <div className="team-invitation-info">
                    <strong>{invitation.email}</strong>
                    <span>
                      {teamRoleLabels[invitation.role]} ·{" "}
                      {invitationStatus(invitation)}
                    </span>
                    <span>
                      Validade: {dateLabel(invitation.expires_at)} · Brasília
                    </span>
                  </div>
                  {!invitation.accepted_at && !invitation.canceled_at ? (
                    <div className="team-invitation-controls">
                      <InvitationRenewal
                        companyId={companyId}
                        invitationId={invitation.id}
                        deliveryEnabled={deliveryEnabled}
                      />
                      <form action={cancelInvitation}>
                        <input
                          type="hidden"
                          name="company_id"
                          value={companyId}
                        />
                        <input
                          type="hidden"
                          name="invitation_id"
                          value={invitation.id}
                        />
                        <ConfirmSubmit
                          label="Cancelar convite"
                          description={`O link enviado para ${invitation.email} deixará de permitir o aceite. Isso não altera acessos já concedidos.`}
                        />
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {!invitationsResult.error && pages > 1 ? (
            <nav
              className="team-invitation-pagination"
              aria-label="Páginas de convites"
            >
              {currentPage > 1 ? (
                <Link href={invitationUrl(currentPage - 1)}>← Anterior</Link>
              ) : (
                <span />
              )}
              <span>
                Página {currentPage} de {pages}
              </span>
              {currentPage < pages ? (
                <Link href={invitationUrl(currentPage + 1)}>Próxima →</Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
          <p className="operations-field-note">
            Aguarde 60 segundos entre emissões para o mesmo e-mail. O limite é
            de 25 emissões nas últimas 24 horas, incluindo renovações. O aceite
            depende das vagas e da assinatura no momento da confirmação.
          </p>
        </section>
      ) : null}
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
                        <h3>
                          {professional.name}
                          {professional.archived_at ? " · Arquivado" : ""}
                        </h3>
                        <p>
                          {professional.user_id
                            ? `Conta vinculada: ${currentMember?.email || "e-mail indisponível"}`
                            : "Nenhuma conta vinculada"}
                        </p>
                        {professional.archived_at ? (
                          <p>
                            O histórico e o acesso vinculado foram mantidos.
                            Reative o cadastro para associar uma nova conta.
                          </p>
                        ) : null}
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
                          disabled={
                            (Boolean(professional.archived_at) &&
                              member.user_id !== professional.user_id) ||
                            professionals.some(
                              (person) =>
                                person.id !== professional.id &&
                                person.user_id === member.user_id,
                            )
                          }
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
                    ) : professional.archived_at ? (
                      <Link
                        href={`/painel/${companyId}/professionals/${professional.id}`}
                      >
                        Ver cadastro arquivado
                      </Link>
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
