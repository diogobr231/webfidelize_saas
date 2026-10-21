import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { canManage, hasAccess } from "@/lib/permissions";
import { money } from "@/lib/catalog";
import { appointmentStatus } from "@/lib/scheduling";
import { recordFilters, recordPagination } from "@/lib/record-list";
import {
  businessContextSchema,
  businessLabels,
  historyAppointmentTime,
  relatedBusinessName,
  type BusinessRecord,
} from "@/lib/business-records";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { archiveRecord, updateRecord } from "./actions";
import { RecordArchiveForm, RecordEditForm } from "./forms";
import { CustomerWhatsAppConsentForm } from "../../lembretes/forms";
import { saveCustomerWhatsAppConsent } from "../../lembretes/actions";
import "../../../operations.css";
import "../records.css";
import "./details.css";
import "../../lembretes/reminders.css";

export default async function RecordDetails({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; section: string; recordId: string }>;
  searchParams: Promise<{
    pagina?: string | string[];
    salvo?: string;
    aviso?: string;
  }>;
}) {
  const parsed = businessContextSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const context = parsed.data;
  const { companyId, section, recordId } = context;
  const { db, company, role } = await requireCompany(companyId);
  const query = await searchParams;
  const { data, error } = await db
    .from(section)
    .select(
      section === "customers"
        ? "id,name,archived_at,record_version,phone"
        : section === "services"
          ? "id,name,archived_at,record_version,duration_minutes,price_cents"
          : "id,name,archived_at,record_version",
    )
    .eq("company_id", companyId)
    .eq("id", recordId)
    .maybeSingle();
  if (error)
    throw new Error("Não foi possível consultar a ficha. Tente novamente.");
  if (!data) notFound();
  // All three whitelisted projections contain the shared record fields. The
  // ungenerated Supabase client cannot infer this union of table projections.
  const record = data as unknown as BusinessRecord;
  const label = businessLabels[section];
  const archived = Boolean(record.archived_at);
  const managed = canManage(role);
  const writable = managed && hasAccess(company.status, company.trial_ends_at);
  const base = `/painel/${companyId}/${section}`;
  const permalink = `${base}/${recordId}`;
  const requestedPage = recordFilters(query).page;
  const countResult =
    section === "customers"
      ? await db
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("customer_id", recordId)
      : null;
  const pagination = recordPagination(requestedPage, countResult?.count ?? 0);
  const history =
    section === "customers" && !countResult?.error && countResult?.count
      ? await db
          .from("appointments")
          .select(
            "id,starts_at,ends_at,status,services(name),professionals(name)",
          )
          .eq("company_id", companyId)
          .eq("customer_id", recordId)
          .order("starts_at", { ascending: false })
          .order("id", { ascending: false })
          .range(pagination.from, pagination.to)
      : { data: [], error: countResult?.error || null };
  const historyFailed = Boolean(countResult?.error || history.error);
  const total = countResult?.count ?? 0;
  const historyPage = (page: number) => `${permalink}?pagina=${page}#historico`;
  const whatsAppConsent =
    section === "customers" && managed
      ? await db
          .from("whatsapp_consents")
          .select("phone,opted_in_at,revoked_at")
          .eq("company_id", companyId)
          .eq("customer_id", recordId)
          .maybeSingle()
      : null;
  const normalizePhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : digits;
  };
  const consentActive = Boolean(
    whatsAppConsent?.data?.opted_in_at &&
      !whatsAppConsent.data.revoked_at &&
      normalizePhone(whatsAppConsent.data.phone) ===
        normalizePhone(record.phone ?? ""),
  );
  return (
    <>
      <Link
        href={`${base}?estado=${archived ? "arquivados" : "ativos"}`}
        className="business-back"
      >
        <Icon name="chevron-left" size={16} /> Voltar para{" "}
        {label.plural.toLocaleLowerCase("pt-BR")}
      </Link>
      <PageHeader
        eyebrow={
          section === "customers"
            ? "Ficha do cliente"
            : `Detalhes do ${label.singular}`
        }
        title={record.name}
        description={
          section === "customers"
            ? "Informações de contato e atendimentos autorizados para o seu perfil."
            : "Mantenha o cadastro atualizado e preserve os atendimentos registrados."
        }
        action={
          <span className={`business-state${archived ? " is-archived" : ""}`}>
            {archived ? "Arquivado" : "Ativo"}
          </span>
        }
      />
      {query.salvo === "1" ? (
        <p className="notice" role="status">
          Alterações salvas. Os agendamentos registrados foram preservados.
        </p>
      ) : null}
      {query.aviso === "arquivado" && archived ? (
        <p className="notice" role="status">
          Cadastro arquivado. O histórico continua disponível e você pode
          reativá-lo depois.
        </p>
      ) : null}
      {query.aviso === "reativado" && !archived ? (
        <p className="notice" role="status">
          Cadastro reativado. Ele está disponível para novos agendamentos.
        </p>
      ) : null}
      {managed && !writable ? (
        <p className="notice">
          Seu acesso está em modo de consulta. Edições, arquivamento e
          reativação dependem do acesso válido da empresa.
        </p>
      ) : null}
      <div className="business-detail-layout">
        <section
          className="panel business-details"
          aria-labelledby="record-info-title"
        >
          <h2 id="record-info-title">Informações do cadastro</h2>
          {writable && !archived ? (
            <RecordEditForm
              key={record.record_version}
              record={record}
              section={section}
              saveAction={updateRecord.bind(null, context)}
              permalink={permalink}
            />
          ) : (
            <>
              <dl className="business-data">
                <div>
                  <dt>Nome</dt>
                  <dd>{record.name}</dd>
                </div>
                {section === "customers" ? (
                  <div>
                    <dt>Telefone</dt>
                    <dd>{record.phone || "Não informado"}</dd>
                  </div>
                ) : null}
                {section === "services" ? (
                  <>
                    <div>
                      <dt>Duração atual do serviço</dt>
                      <dd>{record.duration_minutes} minutos</dd>
                    </div>
                    <div>
                      <dt>Preço atual do serviço</dt>
                      <dd>{money(record.price_cents ?? 0)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              {archived && writable ? (
                <p className="business-note">
                  Reative o cadastro para editar suas informações.
                </p>
              ) : null}
            </>
          )}
        </section>
        <aside
          className="panel business-lifecycle"
          aria-labelledby="record-state-title"
        >
          <span className="operations-icon">
            <Icon name="shield" size={20} />
          </span>
          <h2 id="record-state-title">
            {archived
              ? "Cadastro arquivado"
              : "Organize sem perder o histórico"}
          </h2>
          <p>
            {archived
              ? "Este cadastro permanece na empresa, mas não aparece nas opções para novos agendamentos."
              : "Arquive quando não precisar mais deste cadastro nas opções de novos agendamentos. Os atendimentos já registrados serão preservados."}
          </p>
          <p>
            Aguarde a conclusão ou cancele os atendimentos futuros ou em
            andamento antes de arquivar. Remarcar para outra data futura mantém
            o vínculo.
          </p>
          {section === "professionals" ? (
            <>
              <p>
                <strong>
                  Arquivar o profissional não revoga o acesso da conta
                  vinculada.
                </strong>{" "}
                O proprietário gerencia os logins em Acessos da equipe.
              </p>
              <p>A reativação depende de uma vaga disponível no plano.</p>
              {role === "OWNER" ? (
                <Link
                  className="business-inline-link"
                  href={`/painel/${companyId}/equipe`}
                >
                  Gerenciar acessos da equipe{" "}
                  <Icon name="arrow-right" size={15} />
                </Link>
              ) : null}
            </>
          ) : null}
          {writable ? (
            <RecordArchiveForm
              key={`${record.record_version}:${archived}`}
              record={record}
              section={section}
              saveAction={archiveRecord.bind(null, context)}
              permalink={permalink}
            />
          ) : null}
        </aside>
      </div>
      {section === "customers" && managed ? (
        <section
          className="panel reminder-page"
          aria-labelledby="customer-reminder-title"
        >
          <h2 id="customer-reminder-title">Lembretes por WhatsApp</h2>
          <p className="reminder-help">
            A autorização vale para o telefone atual e somente para lembretes de
            atendimento. Registre a escolha expressa do cliente; mudar o
            telefone exige nova autorização.
          </p>
          {whatsAppConsent?.error ? (
            <p className="notice error" role="alert">
              Não foi possível consultar a autorização. Atualize a página antes
              de alterar.
            </p>
          ) : (
            <>
              <p>
                {consentActive
                  ? "Autorização registrada para este número."
                  : "Sem autorização ativa para este número."}
              </p>
              <CustomerWhatsAppConsentForm
                key={recordId}
                allowed={consentActive}
                writable={writable && !archived}
                revocable={!archived}
                action={saveCustomerWhatsAppConsent.bind(
                  null,
                  companyId,
                  recordId,
                )}
                permalink={permalink}
              />
            </>
          )}
        </section>
      ) : null}
      {section === "customers" ? (
        <section
          className="panel business-history"
          id="historico"
          aria-labelledby="customer-history-title"
        >
          <div className="business-history-heading">
            <div>
              <h2 id="customer-history-title">Histórico de atendimentos</h2>
              <p>
                {managed
                  ? "Agendamentos deste cliente na empresa, do mais recente para o mais antigo."
                  : "Somente os agendamentos deste cliente que seu perfil tem permissão para consultar."}
              </p>
            </div>
            <span className="operations-count">
              {historyFailed
                ? "Indisponível"
                : `${total.toLocaleString("pt-BR")} registros`}
            </span>
          </div>
          <p className="business-history-note">
            Os nomes de serviços e profissionais são os cadastros atuais. Datas
            e duração vêm de cada agendamento. Este histórico não representa
            vendas ou pagamentos.
          </p>
          {historyFailed ? (
            <EmptyState
              icon="calendar"
              title="Histórico indisponível"
              description="Não foi possível consultar os atendimentos. Atualize a página para tentar novamente."
            />
          ) : !history.data?.length ? (
            <EmptyState
              icon="calendar"
              title="O próximo atendimento começa uma história"
              description={
                managed
                  ? "Os agendamentos deste cliente aparecerão aqui, incluindo concluídos e cancelados."
                  : "Ainda não há atendimentos deste cliente disponíveis para seu perfil."
              }
            />
          ) : (
            <ol className="business-history-list">
              {history.data.map((appointment) => {
                const time = historyAppointmentTime(
                  appointment.starts_at,
                  appointment.ends_at,
                );
                return (
                  <li key={appointment.id}>
                    <div className="business-history-date">
                      <Icon name="calendar" size={17} />
                      <div>
                        <strong>{time?.date || "Data indisponível"}</strong>
                        <span>
                          {time
                            ? `${time.start}–${time.end} · ${time.minutes.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} min`
                            : "Horário indisponível"}
                        </span>
                      </div>
                    </div>
                    <div className="business-history-service">
                      <strong>
                        {relatedBusinessName(appointment.services)}
                      </strong>
                      <span>
                        {relatedBusinessName(appointment.professionals)}
                      </span>
                    </div>
                    <span
                      className={`business-appointment-status is-${appointment.status}`}
                    >
                      {appointmentStatus[appointment.status] ||
                        "Estado indisponível"}
                    </span>
                    {time ? (
                      <Link
                        className="business-history-link"
                        href={`/painel/${companyId}/agenda?day=${time.day}&view=day`}
                      >
                        Ver na agenda <Icon name="arrow-up-right" size={14} />
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {!historyFailed && total > 0 ? (
            <nav
              className="record-pagination"
              aria-label="Páginas do histórico do cliente"
            >
              <p>
                Exibindo {pagination.from + 1}–
                {pagination.from + (history.data?.length ?? 0)} de{" "}
                {total.toLocaleString("pt-BR")}{" "}
                <span>
                  · Página {pagination.page} de {pagination.pages}
                </span>
              </p>
              <div>
                {pagination.page > 1 ? (
                  <Link
                    className="button secondary"
                    href={historyPage(pagination.page - 1)}
                    rel="prev"
                  >
                    <Icon name="chevron-left" size={16} /> Anterior
                  </Link>
                ) : null}
                {pagination.page < pagination.pages &&
                pagination.page < 10_000 ? (
                  <Link
                    className="button secondary"
                    href={historyPage(pagination.page + 1)}
                    rel="next"
                  >
                    Próxima <Icon name="chevron-right" size={16} />
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
          <p className="business-history-zone">Horários de São Paulo.</p>
        </section>
      ) : null}
    </>
  );
}
