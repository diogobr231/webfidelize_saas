import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage, hasAccess } from "@/lib/permissions";
import {
  saoPauloDay,
  addDays,
  localAppointmentInstant,
  appointmentTime,
} from "@/lib/scheduling";
import { SetupGuide } from "@/components/setup-guide";
import { ShareBooking } from "@/components/share-booking";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";

type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customers: { name: string } | null;
  services: { name: string } | null;
  professionals: { name: string } | null;
};
const subscriptionLabels: Record<string, string> = {
  active: "Assinatura ativa",
  past_due: "Pagamento pendente",
  canceled: "Assinatura cancelada",
  suspended: "Acesso suspenso",
};

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ erro?: string; configuracao?: string }>;
}) {
  const { companyId } = await params;
  const { db, company, role } = await requireCompany(companyId);
  const p = await searchParams;
  const managed = canManage(role);
  const now = new Date();
  const day = saoPauloDay(now);
  const start = localAppointmentInstant(day, "00:00")!;
  const end = localAppointmentInstant(addDays(day, 1), "00:00")!;
  const count = (table: string) =>
    db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
  const [today, completed, upcoming, services, professionals, shifts] =
    await Promise.all([
      count("appointments")
        .gte("starts_at", start)
        .lt("starts_at", end)
        .neq("status", "canceled"),
      count("appointments")
        .gte("starts_at", start)
        .lt("starts_at", end)
        .eq("status", "completed"),
      db
        .from("appointments")
        .select(
          "id,starts_at,ends_at,status,customers(name),services(name),professionals(name)",
        )
        .eq("company_id", companyId)
        .eq("status", "scheduled")
        .gt("ends_at", now.toISOString())
        .order("starts_at")
        .limit(6),
      managed ? count("services") : Promise.resolve(null),
      managed ? count("professionals") : Promise.resolve(null),
      managed ? count("availability") : Promise.resolve(null),
    ]);
  const writable = hasAccess(company.status, company.trial_ends_at);
  const published = Boolean(company.booking_enabled && company.booking_slug);
  const publicUrl = published
    ? new URL(
        `/agendar/${company.booking_slug}`,
        process.env.APP_URL || "http://localhost:3000",
      ).toString()
    : "";
  const records = (upcoming.data || []) as unknown as Appointment[];
  const setupError = services?.error || professionals?.error || shifts?.error;
  return (
    <>
      <div className="workspace-page-heading">
        <div>
          <span className="tag">
            {new Intl.DateTimeFormat("pt-BR", {
              dateStyle: "full",
              timeZone: "America/Sao_Paulo",
            }).format(now)}
          </span>
          <h1>Seu dia, mais organizado.</h1>
          <p>
            {managed
              ? "Acompanhe os atendimentos e cuide dos próximos passos do seu negócio."
              : "Seus próximos atendimentos e horários, em um só lugar."}
          </p>
        </div>
        <Link
          className="button"
          href={`/painel/${companyId}/agenda${managed && writable ? "#novo-agendamento" : ""}`}
        >
          {managed && writable ? "+ Novo agendamento" : "Abrir minha agenda"}
        </Link>
      </div>
      <div
        className={`notice workspace-subscription ${!writable ? "error" : ""}`}
      >
        <span>
          {company.status === "trialing"
            ? `Teste gratuito até ${new Date(company.trial_ends_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
            : subscriptionLabels[company.status] || "Consulte sua assinatura"}
        </span>
        {!writable ? (
          <span>
            Alterações bloqueadas.{" "}
            <a
              href="https://wa.me/5518997695445"
              target="_blank"
              rel="noreferrer"
            >
              Fale com o suporte para regularizar ↗
            </a>
          </span>
        ) : (
          <span>Horários no fuso de São Paulo</span>
        )}
      </div>
      {p.erro && (
        <p className="notice error" role="alert">
          Operação não autorizada para seu perfil ou assinatura.
        </p>
      )}
      {managed && p.configuracao === "pausada" && (
        <p className="notice" role="status">
          Os cadastros salvos foram mantidos. Continue quando quiser.{" "}
          <Link
            className="workspace-text-link"
            href={`/painel/${companyId}/configuracao`}
          >
            Continuar configuração guiada →
          </Link>
        </p>
      )}
      {today.error || completed.error ? (
        <p role="alert" className="notice error">
          Não foi possível carregar os indicadores. Atualize a página para
          tentar novamente.
        </p>
      ) : (
        <div className="workspace-metrics">
          <div className="card">
            <span className="workspace-metric-icon" aria-hidden="true">
              <Icon name="calendar" size={18} />
            </span>
            <p>
              {managed ? "Atendimentos de hoje" : "Meus atendimentos de hoje"}
            </p>
            <strong className="stat">{today.count ?? 0}</strong>
            <span>Reservados e concluídos</span>
          </div>
          <div className="card">
            <span className="workspace-metric-icon" aria-hidden="true">
              <Icon name="check" size={18} />
            </span>
            <p>Concluídos hoje</p>
            <strong className="stat">{completed.count ?? 0}</strong>
            <span>Atendimentos finalizados</span>
          </div>
          <Link
            className="card workspace-metric-action"
            href={`/painel/${companyId}/agenda`}
          >
            <span className="workspace-metric-icon" aria-hidden="true">
              <Icon name="arrow-up-right" size={18} />
            </span>
            <p>Sua agenda completa</p>
            <strong>Planeje a semana</strong>
            <span>Ver horários e compromissos →</span>
          </Link>
        </div>
      )}
      <div className={`workspace-overview-grid ${managed ? "has-setup" : ""}`}>
        <section
          className="panel workspace-next"
          aria-labelledby="upcoming-title"
        >
          <div className="workspace-section-heading">
            <div>
              <span className="tag">O que vem a seguir</span>
              <h2 id="upcoming-title">Próximos atendimentos</h2>
            </div>
            <Link
              className="workspace-text-link"
              href={`/painel/${companyId}/agenda`}
            >
              Ver agenda →
            </Link>
          </div>
          {upcoming.error ? (
            <p role="alert" className="notice error">
              Não foi possível carregar os próximos atendimentos.
            </p>
          ) : records.length ? (
            <ul className="workspace-appointments">
              {records.map((appointment) => (
                <li key={appointment.id}>
                  <div className="workspace-appointment-time">
                    <strong>{appointmentTime(appointment.starts_at)}</strong>
                    <span>
                      {new Date(appointment.starts_at).toLocaleDateString(
                        "pt-BR",
                        {
                          timeZone: "America/Sao_Paulo",
                          day: "2-digit",
                          month: "short",
                        },
                      )}
                    </span>
                  </div>
                  <div>
                    <strong>
                      {appointment.customers?.name || "Cliente indisponível"}
                    </strong>
                    <p>
                      {appointment.services?.name || "Serviço indisponível"} ·{" "}
                      {appointment.professionals?.name ||
                        "Profissional indisponível"}
                    </p>
                  </div>
                  <span className="badge">
                    {new Date(appointment.starts_at) <= now
                      ? "Em horário de atendimento"
                      : "Agendado"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="calendar"
              title="Sua agenda está esperando o próximo encontro"
              description={
                managed
                  ? "Adicione um atendimento ou compartilhe seu link para receber reservas."
                  : "Quando houver um atendimento atribuído a você, ele aparecerá aqui."
              }
            >
              <Link
                className="button secondary"
                href={`/painel/${companyId}/agenda`}
              >
                Abrir agenda
              </Link>
            </EmptyState>
          )}
        </section>
        {managed &&
          (setupError ? (
            <p className="notice error" role="alert">
              Não foi possível carregar o progresso da configuração.
            </p>
          ) : (
            <SetupGuide
              companyId={companyId}
              services={services?.count ?? 0}
              professionals={professionals?.count ?? 0}
              shifts={shifts?.count ?? 0}
              published={published}
              owner={role === "OWNER"}
              writable={writable}
            />
          ))}
      </div>
      {managed && published && writable && (
        <section className="panel workspace-share">
          <span className="tag">Leve sua agenda até seus clientes</span>
          <h2>Seu próximo atendimento pode começar com um link.</h2>
          <ShareBooking url={publicUrl} companyName={company.name} />
        </section>
      )}
    </>
  );
}
