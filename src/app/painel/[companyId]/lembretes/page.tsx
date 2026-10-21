import Link from "next/link";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import { hasAccess } from "@/lib/permissions";
import { getWhatsAppConnectionStatus } from "@/lib/whatsapp/server";
import { reminderOffsetLabel, reminderStatuses } from "@/lib/whatsapp-forms";
import { saoPauloDay } from "@/lib/scheduling";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { ReminderSettingsForm } from "./forms";
import { saveReminders } from "./actions";
import "./reminders.css";

const usageSchema = z.object({
  month: z.string(),
  consumed: z.number(),
  effective_limit: z.number(),
});

export default async function Reminders({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { db, company } = await requireCompany(companyId, false, true);
  const [settings, usageResult, history, connection] = await Promise.all([
    db
      .from("whatsapp_settings")
      .select("enabled,offsets_minutes,monthly_limit,platform_limit")
      .eq("company_id", companyId)
      .maybeSingle(),
    db.rpc("whatsapp_usage", { p_company: companyId }),
    db
      .from("whatsapp_reminders")
      .select("id,appointment_id,starts_at,offset_minutes,status,created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(30),
    getWhatsAppConnectionStatus(companyId),
  ]);
  const parsedUsage = usageSchema.safeParse(usageResult.data);
  const usage = parsedUsage.success ? parsedUsage.data : null;
  const settingsFailed = Boolean(settings.error);
  const data = settings.data;
  const effectiveLimit = usage?.effective_limit ?? null;
  const remaining = usage
    ? Math.max(0, usage.effective_limit - usage.consumed)
    : null;
  const date = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <div className="reminder-page">
      <PageHeader
        eyebrow="Contato no momento certo"
        title="Lembretes por WhatsApp"
        description="Ajude seus clientes a lembrar do horário e acompanhe as confirmações de presença na agenda."
        action={
          <Link
            href={`/painel/${companyId}/agenda`}
            className="button secondary"
          >
            <Icon name="calendar" size={16} /> Ver agenda
          </Link>
        }
      />
      <div className="reminder-stats">
        <div>
          <span>Consumo neste mês</span>
          <strong>{usage?.consumed.toLocaleString("pt-BR") ?? "—"}</strong>
          <small>
            {usage
              ? `${usage.month.split("-").reverse().join("/")} · horário de São Paulo`
              : "Não foi possível consultar o consumo."}
          </small>
        </div>
        <div>
          <span>Limite efetivo mensal</span>
          <strong>{effectiveLimit?.toLocaleString("pt-BR") ?? "—"}</strong>
          <small>O menor entre seu limite e a cota da plataforma.</small>
        </div>
        <div>
          <span>Unidades disponíveis</span>
          <strong>{remaining?.toLocaleString("pt-BR") ?? "—"}</strong>
          <small>
            {remaining === 0
              ? "Os envios ficam pausados até haver limite disponível."
              : "Uma unidade por tentativa reservada para envio."}
          </small>
        </div>
      </div>
      {usageResult.error || !usage ? (
        <p className="notice error" role="alert">
          O consumo não pôde ser carregado. Atualize a página para consultar o
          limite real.
        </p>
      ) : null}
      <div className="reminder-grid">
        <section className="panel">
          <span className="reminder-kicker">01 · Preferências</span>
          <h2>Sua rotina de lembretes</h2>
          {settingsFailed ? (
            <p className="notice error" role="alert">
              Não foi possível carregar as preferências. Atualize a página antes
              de editar.
            </p>
          ) : (
            <ReminderSettingsForm
              enabled={data?.enabled ?? false}
              offsets={data?.offsets_minutes ?? [1440]}
              limit={data?.monthly_limit ?? 100}
              writable={hasAccess(company.status, company.trial_ends_at)}
              action={saveReminders.bind(null, companyId)}
              permalink={`/painel/${companyId}/lembretes`}
            />
          )}
        </section>
        <aside>
          <section className="panel">
            <div className="reminder-connection">
              <span className="reminder-connection-icon">
                <Icon name="phone" size={22} />
              </span>
              <div>
                <h2>
                  {connection.configured
                    ? "Configuração encontrada"
                    : "Conexão pendente"}
                </h2>
                <p>{connection.reason}</p>
              </div>
            </div>
            <p className="reminder-help">
              A entrega é confirmada somente quando o WhatsApp informa o
              resultado. Salvar preferências não comprova envio nem aprovação do
              modelo.
            </p>
            {!settingsFailed && (!data || data.platform_limit === 0) ? (
              <p className="notice">
                A cota da plataforma ainda é zero. O administrador precisa
                liberar um limite antes dos envios.
              </p>
            ) : null}
          </section>
          <section className="panel">
            <span className="reminder-kicker">02 · Do lembrete à presença</span>
            <h2>Como funciona</h2>
            <ol className="reminder-flow">
              <li>
                O cliente autoriza os lembretes na reserva pública ou você
                registra a autorização na ficha dele.
              </li>
              <li>
                O sistema verifica o horário atual, a autorização e o limite
                antes de enviar.
              </li>
              <li>
                O cliente abre o link seguro e confirma a presença. A
                confirmação aparece na agenda.
              </li>
              <li>
                Cancelamentos e remarcações invalidam os lembretes anteriores.
              </li>
            </ol>
            <Link
              href={`/painel/${companyId}/customers`}
              className="button secondary"
            >
              Ver fichas dos clientes <Icon name="arrow-right" size={16} />
            </Link>
          </section>
        </aside>
      </div>
      <section className="panel">
        <span className="reminder-kicker">03 · Acompanhamento</span>
        <h2>Últimos lembretes</h2>
        <p className="reminder-help">
          Até 30 registros mais recentes. Enviado, entregue e presença
          confirmada são eventos diferentes. O consumo inclui tentativas
          reservadas, falhas e respostas incertas para evitar ultrapassar o
          limite. Ele não é uma fatura da Meta.
        </p>
        {history.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar os lembretes. Tente atualizar a página.
          </p>
        ) : history.data?.length ? (
          <ol className="reminder-history">
            {history.data.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>Atendimento em {date(item.starts_at)}</strong>
                  <small>
                    {reminderOffsetLabel(item.offset_minutes)} · São Paulo
                  </small>
                  <Link
                    href={`/painel/${companyId}/agenda?day=${saoPauloDay(new Date(item.starts_at))}&view=day`}
                  >
                    Ver na agenda
                  </Link>
                </div>
                <span className={`reminder-badge is-${item.status}`}>
                  {reminderStatuses[item.status] ?? "Estado indisponível"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon="phone"
            title="Os próximos lembretes aparecem aqui"
            description="Ative as preferências, conecte o WhatsApp e registre a autorização dos clientes. O histórico aparecerá quando um lembrete entrar em processamento."
          />
        )}
      </section>
    </div>
  );
}
