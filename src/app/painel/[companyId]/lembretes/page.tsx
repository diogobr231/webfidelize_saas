import Link from "next/link";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  getStaffWhatsAppConnectionStatus,
  getWhatsAppConnectionStatus,
} from "@/lib/whatsapp/server";
import { reminderOffsetLabel, reminderStatuses } from "@/lib/whatsapp-forms";
import { saoPauloDay } from "@/lib/scheduling";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { ReminderSettingsForm, StaffReminderSettingsForm } from "./forms";
import { saveReminders, saveStaffReminders } from "./actions";
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
  const { db, company, role } = await requireCompany(companyId, false, true);
  const [
    settings,
    usageResult,
    history,
    connection,
    staffHistory,
    staffConnection,
  ] = await Promise.all([
    db
      .from("whatsapp_settings")
      .select(
        "enabled,offsets_minutes,monthly_limit,platform_limit,staff_daily_enabled,staff_daily_time,staff_new_appointment_enabled",
      )
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
    db
      .from("whatsapp_staff_notifications")
      .select(
        "id,kind,local_date,starts_at,status,consumed_at,part_index,part_count,created_at",
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(30),
    getStaffWhatsAppConnectionStatus(companyId),
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
        title="WhatsApp para clientes e equipe"
        description="Lembre seus clientes dos horários e mantenha cada profissional informado sobre a própria agenda."
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
          <span>Consumo de clientes e equipe</span>
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
          <small>
            Cota compartilhada: o menor entre seu limite e o da plataforma.
          </small>
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
          <h2>Lembretes para os clientes</h2>
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
              writable={company.access_valid}
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
      <div className="reminder-grid">
        <section className="panel">
          <span className="reminder-kicker">Equipe informada</span>
          <h2>A agenda chega ao profissional</h2>
          <p className="reminder-help reminder-intro">
            Escolha a hora do resumo e avise a equipe quando entrar um novo
            agendamento. Cada pessoa recebe somente os atendimentos vinculados
            ao seu perfil.
          </p>
          {settingsFailed ? (
            <p className="notice error" role="alert">
              Não foi possível carregar as preferências da equipe. Atualize a
              página antes de editar.
            </p>
          ) : (
            <StaffReminderSettingsForm
              dailyEnabled={data?.staff_daily_enabled ?? false}
              dailyTime={data?.staff_daily_time ?? "08:00"}
              newAppointmentEnabled={
                data?.staff_new_appointment_enabled ?? false
              }
              writable={company.access_valid}
              action={saveStaffReminders.bind(null, companyId)}
              permalink={`/painel/${companyId}/lembretes`}
            />
          )}
        </section>
        <aside>
          <section className="panel">
            <div className="reminder-connection">
              <span className="reminder-connection-icon">
                <Icon name="users" size={22} />
              </span>
              <div>
                <h2>
                  {staffConnection.configured
                    ? "Configuração dos avisos encontrada"
                    : "Avisos da equipe: conexão pendente"}
                </h2>
                <p>{staffConnection.reason}</p>
              </div>
            </div>
            <p className="reminder-help reminder-intro">
              A integração oficial, os modelos aprovados pela Meta e o agendador
              em execução são necessários para os envios. Salvar as preferências
              não comprova que uma mensagem foi enviada.
            </p>
            <ol className="reminder-flow">
              <li>
                O proprietário vincula cada conta a um profissional em Equipe e
                acessos.
              </li>
              <li>O profissional autoriza seu próprio WhatsApp em Meu dia.</li>
              <li>
                O resumo sai no horário escolhido. Novos atendimentos entram na
                fila de avisos, respeitando conexão e cota.
              </li>
            </ol>
            <Link
              className="button secondary"
              href={`/painel/${companyId}/${role === "OWNER" ? "equipe" : "meu-dia"}`}
            >
              {role === "OWNER"
                ? "Ver equipe e acessos"
                : "Minha preferência de WhatsApp"}{" "}
              <Icon name="arrow-right" size={16} />
            </Link>
          </section>
        </aside>
      </div>
      <section className="panel">
        <span className="reminder-kicker">Acompanhamento da equipe</span>
        <h2>Últimos avisos aos profissionais</h2>
        <p className="reminder-help">
          Até 30 registros mais recentes. Uma agenda longa pode usar várias
          unidades. A confirmação de entrega depende do WhatsApp; os telefones
          pessoais não são exibidos aqui.
        </p>
        {staffHistory.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar os avisos da equipe. Atualize a página
            para tentar novamente.
          </p>
        ) : staffHistory.data?.length ? (
          <ol className="reminder-history">
            {staffHistory.data.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.kind === "daily"
                      ? "Resumo diário"
                      : "Novo agendamento"}
                  </strong>
                  <small>
                    {item.local_date.split("-").reverse().join("/")} ·{" "}
                    {item.consumed_at
                      ? "1 unidade reservada"
                      : "Sem consumo reservado"}
                    {item.part_count > 1
                      ? ` · Parte ${item.part_index} de ${item.part_count}`
                      : ""}
                  </small>
                  <Link
                    href={`/painel/${companyId}/agenda?day=${item.local_date}&view=day`}
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
            icon="users"
            title="Os avisos da equipe aparecerão aqui"
            description="Configure os avisos e oriente cada profissional a autorizar seu número em Meu dia. O histórico será preenchido pelo processamento real."
          />
        )}
      </section>
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
