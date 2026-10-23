import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { Brand } from "@/components/ui/brand";
import { PageHeader } from "@/components/ui/page-header";
import { snapshotSchema } from "@/lib/billing/schema";
import { money } from "@/lib/catalog";
import "../../admin.css";

const schema = z.object({
  company: z.object({
    id: z.uuid(),
    name: z.string(),
    niche: z.string(),
    plan_id: z.string(),
    status: z.string(),
    trial_ends_at: z.string().nullable(),
    trial_card_required: z.boolean(),
    booking_enabled: z.boolean(),
    booking_slug: z.string().nullable(),
    is_demo: z.boolean(),
  }),
  owners: z.array(
    z.object({
      email: z.string().nullable(),
      confirmed: z.boolean(),
      last_sign_in_at: z.string().nullable(),
    }),
  ),
  counts: z.object({
    customers: z.number(),
    services: z.number(),
    professionals: z.number(),
    appointments: z.number(),
    classes: z.number(),
    blocks: z.number(),
    pending_invitations: z.number(),
  }),
  access: z.object({
    writable: z.boolean(),
    reason: z.enum([
      "active",
      "trialing",
      "trial_expired",
      "pending_card",
      "past_due",
      "canceled",
      "suspended",
    ]),
  }),
});
const reasons: Record<string, string> = {
  active: "Empresa com acesso ativo.",
  trialing: "Empresa em período de teste.",
  trial_expired: "O período de teste terminou.",
  pending_card:
    "O cadastro foi concluído, mas o banco ainda registra ativação pendente. A oferta atual permite teste sem cartão. Verifique o histórico antes de alterar o acesso; os cadastros operacionais continuam bloqueados até uma ativação válida.",
  past_due: "O acesso operacional aguarda regularização da assinatura.",
  canceled: "A empresa está cancelada.",
  suspended: "A empresa está suspensa.",
};
export default async function CompanyDiagnostics({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  if (!z.uuid().safeParse(companyId).success) notFound();
  const { db } = await requireUser();
  const { data: admin, error: authorizationError } =
    await db.rpc("is_super_admin");
  if (authorizationError || admin !== true) notFound();
  const [{ data, error }, billingResult] = await Promise.all([
    db.rpc("admin_company_diagnostics", { p_company: companyId }),
    db.rpc("billing_snapshot", { p_company_id: companyId }),
  ]);
  if (!error && data === null) notFound();
  const parsed = schema.safeParse(data);
  const result = !error && parsed.success ? parsed.data : null;
  const billingParsed = snapshotSchema.safeParse(billingResult.data);
  const billing =
    !billingResult.error &&
    billingParsed.success &&
    billingParsed.data.company.id === companyId
      ? billingParsed.data
      : null;
  const financialStatus: Record<string, string> = {
    approved: "Pagamento aprovado",
    pending: "Pendente",
    in_process: "Em análise",
    authorized: "Recorrência autorizada",
    rejected: "Recusado",
    cancelled: "Cancelado",
    refunded: "Estornado",
    charged_back: "Contestado",
    paused: "Pausado",
  };
  return (
    <main className="admin-shell">
      <nav className="admin-topbar" aria-label="Suporte à empresa">
        <Brand href="/admin" />
        <Link className="button secondary" href="/admin">
          ← Empresas
        </Link>
      </nav>
      <div className="admin-content">
        <PageHeader
          eyebrow="Diagnóstico de acesso"
          title={result?.company.name ?? "Suporte à empresa"}
          description="Consulte o cadastro, a ativação e a estrutura da empresa para orientar o proprietário."
        />
        {!result ? (
          <p className="notice error" role="alert">
            Não foi possível carregar o diagnóstico. Atualize a página para
            tentar novamente.
          </p>
        ) : (
          <>
            <section className="panel">
              <h2>
                {result.access.writable
                  ? "Acesso operacional disponível"
                  : "Acesso operacional pendente"}
              </h2>
              <p>{reasons[result.access.reason]}</p>
              <p>
                Plano: <strong>{result.company.plan_id}</strong> · Segmento:{" "}
                <strong>{result.company.niche}</strong>
                {result.company.is_demo ? " · Empresa de demonstração" : ""}
              </p>
              <Link
                className="button secondary"
                href={`/admin?empresa=${companyId}#empresa-${companyId}`}
              >
                Gerenciar plano e situação
              </Link>
            </section>
            <section className="panel" aria-labelledby="company-billing-title">
              <h2 id="company-billing-title">Assinatura e pagamentos</h2>
              {!billing ? (
                <p className="notice">
                  Não foi possível consultar o histórico financeiro. Nenhum
                  estado de pagamento será presumido.
                </p>
              ) : (
                <>
                  <p>
                    {billing.company.access
                      ? "Acesso vigente confirmado pelo banco."
                      : "Sem período de acesso vigente."}
                    {billing.company.paid_until
                      ? ` Validade paga registrada: ${new Date(billing.company.paid_until).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
                      : " Ainda não há período pago confirmado."}
                  </p>
                  {billing.subscription && (
                    <p>
                      Cartão ·{" "}
                      {financialStatus[billing.subscription.status] ||
                        "Em verificação"}
                      . A autorização da recorrência exige confirmação de cada
                      pagamento.
                      {billing.subscription.environment === "test" &&
                        " Assinatura de teste, sem cobrança real."}
                    </p>
                  )}
                  {billing.payments.length ? (
                    <ul className="admin-billing-history">
                      {billing.payments.map((payment) => (
                        <li
                          key={`${payment.environment}:${payment.provider_id}`}
                        >
                          <strong>
                            {money(payment.amount_cents)} ·{" "}
                            {payment.method === "pix" ? "Pix" : "Cartão"}
                          </strong>
                          {payment.environment === "test" && (
                            <span>Teste · sem cobrança real</span>
                          )}
                          <span>
                            {financialStatus[payment.status] ||
                              "Em verificação"}
                          </span>
                          {payment.approved_at && (
                            <time dateTime={payment.approved_at}>
                              {new Date(payment.approved_at).toLocaleDateString(
                                "pt-BR",
                                { timeZone: "America/Sao_Paulo" },
                              )}
                            </time>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nenhum pagamento registrado para esta empresa.</p>
                  )}
                  <p className="hint">
                    Consulta administrativa. Contratação e cancelamento da
                    renovação são feitos pelo proprietário. Esta tela não cobra,
                    não estorna valores e não libera acesso pago manualmente.
                  </p>
                </>
              )}
            </section>
            <section className="panel">
              <h2>Acesso do proprietário</h2>
              <p>
                Uma conta de cliente acessa a própria empresa. O SUPER_ADMIN é
                exclusivo dos administradores autorizados da Web Fidelize.
              </p>
              {result.owners.length ? (
                result.owners.map((owner, i) => (
                  <article className="notice" key={i}>
                    <strong style={{ overflowWrap: "anywhere" }}>
                      {owner.email || "E-mail não informado"}
                    </strong>
                    <p>
                      {owner.confirmed
                        ? "E-mail confirmado"
                        : "Confirmação de e-mail pendente"}{" "}
                      ·{" "}
                      {owner.last_sign_in_at
                        ? `Último acesso: ${new Date(owner.last_sign_in_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                        : "Ainda não entrou no sistema"}
                    </p>
                  </article>
                ))
              ) : (
                <p>
                  Nenhum proprietário encontrado. Revise o cadastro antes de
                  alterar permissões.
                </p>
              )}
              <p>
                Senhas são protegidas e não podem ser consultadas. Oriente o
                cliente a redefinir a senha pelo endereço abaixo. O titular
                recebe o link de recuperação; esta tela não redefine a senha nem
                envia mensagens.
              </p>
              <Link className="button secondary" href="/recuperar">
                Abrir recuperação de senha
              </Link>
            </section>
            <section className="panel">
              <h2>Estrutura cadastrada</h2>
              <dl className="admin-diagnostic-counts">
                {Object.entries({
                  Clientes: result.counts.customers,
                  Serviços: result.counts.services,
                  Profissionais: result.counts.professionals,
                  "Agendamentos individuais": result.counts.appointments,
                  Turmas: result.counts.classes,
                  "Horários bloqueados": result.counts.blocks,
                  "Convites pendentes": result.counts.pending_invitations,
                }).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Página pública:{" "}
                {result.company.booking_enabled ? "habilitada" : "desabilitada"}
                . O acesso público também depende da situação da empresa.
              </p>
              {result.company.booking_enabled &&
                result.company.booking_slug && (
                  <Link
                    className="button secondary"
                    href={`/agendar/${result.company.booking_slug}`}
                  >
                    Conferir página de agendamento
                  </Link>
                )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
