import { requireCompany } from "@/lib/auth";
import { invite } from "./actions";
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
      <h2>Equipe e permissões</h2>
      {error && (
        <p className="notice error">Não foi possível carregar a equipe.</p>
      )}
      <div className="panel">
        <p>
          {members?.length ?? 0} vínculos acessíveis. Profissionais da agenda
          são cadastrados na seção Profissionais.
        </p>
        {members?.map((m) => (
          <p key={m.user_id}>
            {m.user_id} · {m.role}
          </p>
        ))}
      </div>
      {p.erro && (
        <p role="alert" className="notice error">
          Não foi possível criar o convite. Confira sua assinatura e permissões.
        </p>
      )}
      {p.convite && /^[a-f0-9]{64}$/.test(p.convite) && role === "OWNER" && (
        <div className="notice">
          <strong>Compartilhe este link somente com o destinatário:</strong>
          <p style={{ wordBreak: "break-all" }}>
            {process.env.APP_URL}/convite/{p.convite}
          </p>
          Válido por 48 horas. O destinatário precisa confirmar o e-mail e
          entrar na conta antes de aceitar.
        </div>
      )}
      {role === "OWNER" && (
        <section className="panel" style={{ marginTop: 20 }}>
          <h3>Convidar colaborador</h3>
          <form action={invite}>
            <input name="company_id" type="hidden" value={companyId} />
            <label htmlFor="email">E-mail do colaborador</label>
            <input id="email" name="email" type="email" required />
            <label htmlFor="role">Permissão</label>
            <select id="role" name="role">
              <option value="EMPLOYEE">
                Colaborador: agenda atribuída e clientes relacionados
              </option>
              <option value="MANAGER">
                Gerente: cadastros e agenda da empresa
              </option>
            </select>
            <button>Gerar convite de uso único</button>
          </form>
        </section>
      )}
    </>
  );
}
