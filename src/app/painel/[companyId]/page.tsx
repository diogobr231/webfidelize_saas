import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { canManage, hasAccess } from "@/lib/permissions";
import { saoPauloDay, appointmentTime } from "@/lib/scheduling";
import {
  dashboardGrowth,
  dashboardPeriodLabel,
  dashboardRange,
  type DashboardData,
} from "@/lib/dashboard";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { MetricCard } from "@/components/dashboard/metric-card";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { SetupGuide } from "@/components/setup-guide";
import { ShareBooking } from "@/components/share-booking";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import "./dashboard.css";

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
  searchParams: Promise<{
    erro?: string;
    configuracao?: string;
    periodo?: string | string[];
    inicio?: string | string[];
    fim?: string | string[];
  }>;
}) {
  const { companyId } = await params;
  const { db, company, role } = await requireCompany(companyId);
  const p = await searchParams;
  const managed = canManage(role);
  const now = new Date();
  const range = dashboardRange(p, now);
  const count = (table: "services" | "professionals" | "availability") => {
    const query = db
      .from(table)
      .select(
        table === "availability" ? "id,professionals!inner(archived_at)" : "id",
        { count: "exact", head: true },
      )
      .eq("company_id", companyId);
    return query.is(
      table === "availability" ? "professionals.archived_at" : "archived_at",
      null,
    );
  };
  const [metrics, upcoming, services, professionals, shifts] =
    await Promise.all([
      db.rpc("executive_dashboard", {
        p_company: companyId,
        p_start: range.start,
        p_end: range.end,
      }),
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
  const data = metrics.data as DashboardData | null;
  // A mismatched scope is never rendered, even if a future database regression occurs.
  const metricsError =
    metrics.error || !data || data.scope !== (managed ? "company" : "personal");
  const growth = data
    ? dashboardGrowth(data.current.appointments, data.previous.appointments)
    : null;
  const format = (value: number) => value.toLocaleString("pt-BR");
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
          <h1>
            {managed
              ? "Seu negócio, em perspectiva."
              : "Seu dia, mais organizado."}
          </h1>
          <p>
            {managed
              ? "Entenda seus resultados e encontre o próximo passo para crescer."
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
      <PeriodFilter
        companyId={companyId}
        range={range}
        today={saoPauloDay(now)}
      />
      {range.error && (
        <p className="notice error" role="alert">
          {range.error}
        </p>
      )}
      <div className="executive-period-caption">
        <strong>{dashboardPeriodLabel(range.start, range.end)}</strong>
        <span>
          Comparação:{" "}
          {dashboardPeriodLabel(range.previousStart, range.previousEnd)} · Fuso
          de São Paulo
        </span>
      </div>
      {!managed && (
        <p className="executive-scope">
          <Icon name="shield" size={16} /> Visão pessoal: somente os
          atendimentos atribuídos a você.
        </p>
      )}
      {metricsError ? (
        <p role="alert" className="notice error">
          Não foi possível carregar os indicadores. Atualize a página para
          tentar novamente.
        </p>
      ) : (
        <>
          <div className="executive-metrics">
            <MetricCard
              label={managed ? "Agendamentos" : "Meus agendamentos"}
              value={format(data.current.appointments)}
              icon="calendar"
              detail="Atendimentos com data no período, incluindo cancelados."
              trend={
                <span>
                  {format(data.previous.appointments)} no período anterior
                </span>
              }
            />
            <MetricCard
              label="Atendimentos concluídos"
              value={format(data.current.completed)}
              icon="check"
              detail={`${format(data.current.attended_customers)} ${data.current.attended_customers === 1 ? "cliente atendido" : "clientes atendidos"} no período.`}
              trend={<span>Conclusão registrada na agenda</span>}
            />
            {managed && data.customers && (
              <MetricCard
                label="Clientes cadastrados"
                value={format(data.customers.total)}
                icon="users"
                  detail="Total da base, incluindo clientes arquivados."
                trend={
                  <span>
                    <strong>{format(data.customers.new)}</strong> novos no
                    período selecionado
                  </span>
                }
              />
            )}
            <MetricCard
              label="Crescimento da agenda"
              value={
                growth === null
                  ? "—"
                  : `${growth > 0 ? "+" : ""}${growth.toLocaleString("pt-BR")}%`
              }
              icon="arrow-up-right"
              detail="Variação dos agendamentos em relação ao período anterior de mesma duração."
              trend={
                <span
                  className={
                    growth !== null && growth > 0 ? "executive-positive" : ""
                  }
                >
                  {growth === null
                    ? "Sem base anterior para calcular a variação"
                    : growth === 0
                      ? "Mesmo volume do período anterior"
                      : growth > 0
                        ? "Mais agendamentos neste período"
                        : "Menos agendamentos neste período"}
                </span>
              }
            />
            {managed && (
              <>
                <MetricCard
                  label="Faturamento"
                  value="—"
                  icon="briefcase"
                  unavailable
                  detail="Ainda não há um registro de recebimentos integrado para calcular este indicador."
                  trend={<span>Atendimentos não comprovam pagamentos.</span>}
                />
                <MetricCard
                  label="Vendas"
                  value="—"
                  icon="layout"
                  unavailable
                  detail="O registro de vendas ainda não está disponível neste sistema."
                  trend={<span>Nenhuma venda ou valor é estimado.</span>}
                />
              </>
            )}
          </div>
          {managed &&
            data.customers &&
            data.customers.without_created_at > 0 && (
              <p className="executive-data-note">
                <Icon name="help" size={16} />
                <span>
                  {format(data.customers.without_created_at)}{" "}
                  {data.customers.without_created_at === 1
                    ? "cadastro anterior não tem"
                    : "cadastros anteriores não têm"}{" "}
                  data de criação registrada. Esses clientes entram no total da
                  base, mas não na contagem de novos clientes.
                </span>
              </p>
            )}
          <div className="executive-insights">
            <TrendChart
              key={`${range.start}-${range.end}`}
              daily={data.daily}
              managed={managed}
            />
            <section
              className="panel executive-status"
              aria-labelledby="executive-status-title"
            >
              <div className="executive-panel-heading">
                <div>
                  <span className="tag">Acompanhe cada etapa</span>
                  <h2 id="executive-status-title">Situação dos atendimentos</h2>
                </div>
              </div>
              {data.current.appointments === 0 ? (
                <EmptyState
                  icon="calendar"
                  title="Ainda sem atendimentos no período"
                  description="Assim que a agenda tiver registros, você verá a distribuição por situação aqui."
                />
              ) : (
                <ul>
                  {(
                    [
                      ["scheduled", "Agendados", data.current.scheduled],
                      ["completed", "Concluídos", data.current.completed],
                      ["canceled", "Cancelados", data.current.canceled],
                    ] as const
                  ).map(([status, label, count]) => (
                    <li key={status}>
                      <div>
                        <span>
                          <i
                            className={`executive-status-dot is-${status}`}
                            aria-hidden="true"
                          />
                          {label}
                        </span>
                        <strong>
                          {format(count)}{" "}
                          <small>
                            (
                            {Math.round(
                              (count / data.current.appointments) * 100,
                            )}
                            %)
                          </small>
                        </strong>
                      </div>
                      <div
                        className="executive-status-track"
                        aria-hidden="true"
                      >
                        <span
                          className={`is-${status}`}
                          style={{
                            width: `${(count / data.current.appointments) * 100}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Situação atual dos atendimentos com data no período selecionado.
              </p>
              <Link
                className="button secondary"
                href={`/painel/${companyId}/agenda?day=${range.end}`}
              >
                Ver na agenda <Icon name="arrow-right" size={16} />
              </Link>
            </section>
          </div>
        </>
      )}
      <section
        className="executive-shortcuts"
        aria-labelledby="executive-shortcuts-title"
      >
        <div>
          <span className="tag">Menos cliques, mais tempo</span>
          <h2 id="executive-shortcuts-title">O que você quer fazer agora?</h2>
        </div>
        <div className="executive-shortcut-list">
          <Link
            href={`/painel/${companyId}/agenda${managed && writable ? "#novo-agendamento" : ""}`}
          >
            <Icon name="calendar" size={20} />
            <span>
              {managed && writable ? "Novo agendamento" : "Abrir minha agenda"}
            </span>
            <Icon name="chevron-right" size={16} />
          </Link>
          {managed && (
            <>
              <Link
                href={`/painel/${companyId}/customers${writable ? "#novo-registro" : ""}`}
              >
                <Icon name="users" size={20} />
                <span>
                  {writable ? "Cadastrar cliente" : "Consultar clientes"}
                </span>
                <Icon name="chevron-right" size={16} />
              </Link>
              <Link href={`/painel/${companyId}/disponibilidade`}>
                <Icon name="clock" size={20} />
                <span>Horários de atendimento</span>
                <Icon name="chevron-right" size={16} />
              </Link>
              <Link href={`/painel/${companyId}/services`}>
                <Icon name="briefcase" size={20} />
                <span>Gerenciar serviços</span>
                <Icon name="chevron-right" size={16} />
              </Link>
            </>
          )}
        </div>
      </section>
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
