import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import {
  addDays,
  agendaRange,
  appointmentStatus,
  appointmentTime,
  saoPauloDay,
  validDay,
} from "@/lib/scheduling";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { myStaffWhatsAppPreferenceSchema } from "@/lib/whatsapp-forms";
import { getStaffWhatsAppConnectionStatus } from "@/lib/whatsapp/server";
import { MyWhatsAppPreferenceForm } from "./whatsapp-form";
import { completeMyAppointment, saveMyWhatsAppPreference } from "./actions";
import "@/components/team/team.css";
import "../lembretes/reminders.css";

export default async function MyDay({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    day?: string;
    pagina?: string;
    salvo?: string;
    erro?: string;
  }>;
}) {
  const { companyId } = await params;
  const { db, user, role, company } = await requireCompany(companyId);
  const query = await searchParams;
  const now = new Date();
  const day = validDay(query.day) ? query.day : saoPauloDay(now);
  const base = `/painel/${companyId}`;
  const writable = company.access_valid;
  const [preferenceResult, professional] = await Promise.all([
    db.rpc("get_my_whatsapp_staff_preferences", { p_company: companyId }),
    role === "EMPLOYEE"
      ? db
          .from("professionals")
          .select("id,name")
          .eq("company_id", companyId)
          .eq("user_id", user.id)
          .is("archived_at", null)
          .maybeSingle()
      : Promise.resolve(null),
  ]);
  const parsedPreference = myStaffWhatsAppPreferenceSchema.safeParse(
    preferenceResult.data,
  );
  const preference =
    !preferenceResult.error && parsedPreference.success
      ? parsedPreference.data
      : null;
  const staffConnection = getStaffWhatsAppConnectionStatus(companyId);
  const whatsAppPreference = (
    <section
      className="panel my-day-whatsapp"
      aria-labelledby="my-whatsapp-title"
    >
      <details>
        <summary>
          <span>
            <strong id="my-whatsapp-title">Minha agenda no WhatsApp</strong>
            <small>
              {preference?.enabled
                ? "Autorização registrada · gerenciar preferência"
                : "Receba seu resumo diário e avisos de novos agendamentos"}
            </small>
          </span>
        </summary>
        <div className="my-day-whatsapp-content">
          <p className="reminder-help">
            A empresa define o horário do resumo e quais avisos estão ativos.
            Você recebe somente sua própria agenda e pode revogar a autorização
            quando quiser.
          </p>
          <p className="notice">
            {staffConnection.reason} Os avisos compartilham a cota de mensagens
            da empresa.
          </p>
          {preference ? (
            <MyWhatsAppPreferenceForm
              key={`${preference.phone ?? "none"}-${preference.enabled}`}
              phone={preference.phone}
              enabled={preference.enabled}
              writable={writable && Boolean(preference.professional_id)}
              action={saveMyWhatsAppPreference.bind(null, companyId)}
              permalink={`${base}/meu-dia`}
            />
          ) : (
            <p className="notice error" role="alert">
              Não foi possível carregar sua preferência de WhatsApp. Atualize a
              página antes de editar.
            </p>
          )}
        </div>
      </details>
    </section>
  );
  const header = (
    <>
      <PageHeader
        eyebrow="Sua rotina de atendimento"
        title="Meu dia"
        description="Seus atendimentos, confirmações e próximos passos. Horários no fuso de São Paulo."
      />
      <p>
        <Link className="button secondary" href={`${base}/turmas?day=${day}`}>
          Ver turmas e participantes
        </Link>
      </p>
    </>
  );
  if (role !== "EMPLOYEE")
    return (
      <>
        {header}
        {whatsAppPreference}
        <section className="panel">
          <EmptyState
            icon="calendar"
            title="Acompanhe sua equipe pela agenda"
            description="O Meu dia organiza os atendimentos do colaborador vinculado a um profissional. Como responsável pela empresa, você acompanha os horários na agenda e os resultados nos indicadores de equipe."
          >
            <Link className="button" href={`${base}/agenda`}>
              Abrir agenda da empresa
            </Link>
            <Link
              className="button secondary"
              href={`${base}/equipe/indicadores`}
            >
              Ver indicadores de equipe
            </Link>
          </EmptyState>
        </section>
      </>
    );

  if (professional?.error)
    return (
      <>
        {header}
        {whatsAppPreference}
        <p className="notice error" role="alert">
          Não foi possível consultar seu vínculo. Atualize a página para tentar
          novamente.
        </p>
      </>
    );
  if (!professional?.data)
    return (
      <>
        {header}
        {whatsAppPreference}
        <section className="panel">
          <EmptyState
            icon="user"
            title="Seu perfil ainda precisa de um vínculo"
            description="Peça ao proprietário para vincular sua conta a um profissional ativo em Equipe e acessos. Seus atendimentos aparecerão aqui depois desse vínculo."
          />
        </section>
      </>
    );

  const page = /^\d{1,6}$/.test(query.pagina || "")
    ? Math.max(1, Number(query.pagina))
    : 1;
  const range = agendaRange(day, "day");
  const result = await db
    .from("appointments")
    .select(
      "id,starts_at,ends_at,status,attendance_confirmed_at,customers(name),services(name)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .eq("professional_id", professional.data.id)
    .gte("starts_at", range.start)
    .lt("starts_at", range.end)
    .order("starts_at")
    .order("id")
    .range((page - 1) * 50, page * 50 - 1);
  const href = (date: string, targetPage = 1) =>
    `${base}/meu-dia?${new URLSearchParams({ day: date, ...(targetPage > 1 ? { pagina: String(targetPage) } : {}) })}`;
  const name = (relation: unknown) => {
    const value = Array.isArray(relation) ? relation[0] : relation;
    return value && typeof value === "object" && "name" in value
      ? String(value.name)
      : "Cadastro indisponível";
  };
  const previousDay = addDays(day, -1);
  const nextDay = addDays(day, 1);
  return (
    <>
      {header}
      {whatsAppPreference}
      <form key={day} className="panel team-filters" method="get">
        <label htmlFor="my-day">
          Dia de atendimento
          <input
            id="my-day"
            name="day"
            type="date"
            min="1900-01-01"
            max="2099-12-31"
            defaultValue={day}
            required
          />
        </label>
        <button type="submit">Ver atendimentos</button>
        <Link className="button secondary" href={href(saoPauloDay(now))}>
          Hoje
        </Link>
      </form>
      <div className="team-period-nav">
        {validDay(previousDay) ? (
          <Link href={href(previousDay)}>← Dia anterior</Link>
        ) : (
          <span />
        )}
        <span>{professional.data.name}</span>
        {validDay(nextDay) ? (
          <Link href={href(nextDay)}>Próximo dia →</Link>
        ) : (
          <span />
        )}
      </div>
      {query.salvo === "concluido" && (
        <p className="notice" role="status">
          Atendimento marcado como concluído.
        </p>
      )}
      {query.erro && (
        <p className="notice error" role="alert">
          Não foi possível concluir o atendimento. Confira seu vínculo, o acesso
          da empresa e se o horário terminou. Atualize a página antes de tentar
          novamente.
        </p>
      )}
      {!writable && (
        <p className="notice" role="status">
          Seu acesso está disponível para consulta. Peça ao proprietário para
          verificar a ativação da empresa antes de concluir atendimentos.
        </p>
      )}
      {result.error ? (
        <p className="notice error" role="alert">
          Não foi possível consultar os atendimentos. Atualize a página para
          tentar novamente.
        </p>
      ) : result.data?.length ? (
        <>
          <p className="team-caption">
            {result.count} atendimento(s) neste dia. Exibindo até 50 por página.
          </p>
          <div className="team-day-list">
            {result.data.map((appointment) => (
              <article className="panel team-appointment" key={appointment.id}>
                <div className="team-appointment-time">
                  <strong>{appointmentTime(appointment.starts_at)}</strong>
                  <span>até {appointmentTime(appointment.ends_at)}</span>
                </div>
                <div className="team-appointment-info">
                  <h2>{name(appointment.customers)}</h2>
                  <p>{name(appointment.services)}</p>
                  <div className="team-statuses">
                    <span>
                      {appointmentStatus[appointment.status] ||
                        "Situação indisponível"}
                    </span>
                    {appointment.status !== "canceled" && (
                      <span>
                        {appointment.attendance_confirmed_at
                          ? "Presença confirmada"
                          : "Confirmação não registrada"}
                      </span>
                    )}
                  </div>
                </div>
                {writable &&
                  appointment.status === "scheduled" &&
                  Date.parse(appointment.ends_at) <= now.getTime() && (
                    <form action={completeMyAppointment.bind(null, companyId)}>
                      <input
                        type="hidden"
                        name="appointment_id"
                        value={appointment.id}
                      />
                      <input type="hidden" name="day" value={day} />
                      <ConfirmSubmit
                        label="Concluir atendimento"
                        description="Confirme que este atendimento foi realizado. A conclusão será registrada no histórico do cliente e nos indicadores da empresa."
                      />
                    </form>
                  )}
              </article>
            ))}
          </div>
          <nav
            className="team-pagination"
            aria-label="Páginas dos atendimentos"
          >
            {page > 1 && (
              <Link className="button secondary" href={href(day, page - 1)}>
                Anterior
              </Link>
            )}
            <span>Página {page}</span>
            {page * 50 < (result.count || 0) && (
              <Link className="button secondary" href={href(day, page + 1)}>
                Próxima
              </Link>
            )}
          </nav>
        </>
      ) : (
        <section className="panel">
          <EmptyState
            icon="calendar"
            title={
              page > 1
                ? "Nenhum atendimento nesta página"
                : "Um dia sem atendimentos cadastrados"
            }
            description="Escolha outra data para consultar sua agenda. Somente os atendimentos do profissional vinculado à sua conta aparecem aqui."
          >
            {page > 1 && <Link href={href(day)}>Voltar à primeira página</Link>}
          </EmptyState>
        </section>
      )}
    </>
  );
}
