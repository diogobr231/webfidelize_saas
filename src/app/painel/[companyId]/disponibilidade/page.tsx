import type { CSSProperties } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { canManage } from "@/lib/permissions";
import { PendingButton } from "@/components/pending-button";
import { ShareBooking } from "@/components/share-booking";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { addDays, agendaRange, saoPauloDay, validDay } from "@/lib/scheduling";
import { BLOCKS_PAGE_SIZE, blockPage } from "@/lib/schedule-blocks";
import { ScheduleBlockForm } from "@/components/scheduling-blocks/block-form";
import { ScheduleBlockList } from "@/components/scheduling-blocks/block-list";
import {
  addShift,
  removeShift,
  configure,
  configureProfile,
  createScheduleBlock,
  removeScheduleBlock,
} from "./actions";
import "../../operations.css";

const days = [
  "",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
  "Domingo",
];
const themes = [
  { value: "teal", label: "Turquesa", color: "#2dd4bf" },
  { value: "blue", label: "Azul", color: "#38bdf8" },
  { value: "violet", label: "Violeta", color: "#a78bfa" },
  { value: "rose", label: "Rosa", color: "#fb7185" },
];
const time = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function Availability({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    erro?: string;
    salvo?: string;
    bloqueios_de?: string;
    bloqueios_pagina?: string;
  }>;
}) {
  const { companyId } = await params;
  const { db, role, company } = await requireCompany(companyId);
  const q = await searchParams;
  const blockDay = validDay(q.bloqueios_de) ? q.bloqueios_de : saoPauloDay();
  const blockLastDay = addDays(blockDay, 29);
  const page = blockPage(q.bloqueios_pagina);
  const blockHref = (target: string, page = 1) =>
    `/painel/${companyId}/disponibilidade?${new URLSearchParams({ bloqueios_de: target, bloqueios_pagina: String(page) })}#bloqueios`;
  const [shifts, professionals, blocks] = await Promise.all([
    db
      .from("availability")
      .select("id,professional_id,weekday,start_minute,end_minute")
      .eq("company_id", companyId)
      .order("weekday")
      .order("start_minute"),
    db
      .from("professionals")
      .select("id,name,archived_at")
      .eq("company_id", companyId)
      .order("name"),
    db
      .from("schedule_blocks")
      .select("id,professional_id,starts_at,ends_at,reason", { count: "exact" })
      .eq("company_id", companyId)
      .lt("starts_at", agendaRange(blockLastDay, "day").end)
      .gt("ends_at", agendaRange(blockDay, "day").start)
      .order("starts_at")
      .order("id")
      .range((page - 1) * BLOCKS_PAGE_SIZE, page * BLOCKS_PAGE_SIZE - 1),
  ]);
  const activeProfessionals =
    professionals.data?.filter((professional) => !professional.archived_at) ??
    [];
  const writable = company.access_valid;
  const managed = canManage(role);
  const enabled = company.booking_enabled && company.booking_slug;
  const publicUrl = company.booking_slug
    ? new URL(
        `/agendar/${company.booking_slug}`,
        process.env.APP_URL || "http://localhost:3000",
      ).toString()
    : "";
  const messages: Record<string, string> = {
    confirmacao: "Confirme a remoção do turno antes de continuar.",
    "confirmar-bloqueio": "Confirme a remoção do bloqueio antes de continuar.",
    "remover-bloqueio":
      "Não foi possível remover o bloqueio. Atualize a página e tente novamente.",
    turno:
      "Não foi possível adicionar o turno. Confira se o fim é depois do início e se já existe outro turno nesse horário.",
    remover:
      "Não foi possível remover o turno. Atualize a página e tente novamente.",
    slug: "Use um endereço com 3 a 60 caracteres: letras minúsculas, números e hífen.",
    pagina:
      "Não foi possível salvar a página. Confira se o endereço escolhido já está em uso.",
    perfil:
      "Não foi possível salvar a apresentação. Confira os limites dos campos e seu acesso.",
  };
  return (
    <>
      <PageHeader
        eyebrow="Disponibilidade e presença online"
        title={managed ? "Horários e sua página" : "Meus horários"}
        description={
          managed
            ? "Organize os turnos da equipe e prepare a página que seus clientes vão conhecer."
            : "Confira os turnos disponíveis para receber seus atendimentos."
        }
      />
      <div className="operations-context">
        <Icon name="clock" size={18} />
        <p>
          Horários no fuso de São Paulo. Turnos separados permitem reservar um
          intervalo para almoço. Alterar os turnos preserva os agendamentos já
          feitos.
        </p>
      </div>
      {!writable && (
        <p className="notice error">
          Sua assinatura permite consultar os horários, mas as alterações estão
          bloqueadas. Fale com o suporte para regularizar.
        </p>
      )}
      {q.erro && (
        <p role="alert" className="notice error">
          {messages[q.erro] ||
            "Não foi possível salvar. Verifique seus dados e permissões."}
        </p>
      )}
      {q.salvo && !q.erro && (
        <p role="status" className="notice">
          {{
            turno: "Turno adicionado.",
            remover:
              "Turno removido. Os agendamentos existentes foram preservados.",
            pagina: "Configuração da página salva.",
            perfil: "Apresentação da sua empresa salva.",
            bloqueio:
              "Bloqueio criado. O intervalo está indisponível para novas reservas.",
            "remover-bloqueio":
              "Bloqueio removido. Os turnos regulares voltaram a valer.",
          }[q.salvo] || "Configuração salva."}
        </p>
      )}
      {(shifts.error || professionals.error) && (
        <p className="notice error" role="alert">
          Não foi possível carregar os horários. Atualize a página para tentar
          novamente.
        </p>
      )}
      <div className="availability-columns" id="turnos">
        <section className="panel availability-week-panel">
          <div className="operations-section-title">
            <span className="operations-icon">
              <Icon name="calendar" size={18} />
            </span>
            <h2>Sua semana de atendimento</h2>
          </div>
          <p>
            {managed
              ? "Confira a disponibilidade de cada profissional."
              : "Estes são os turnos vinculados ao seu perfil."}
          </p>
          {shifts.error || professionals.error ? (
            <EmptyState
              icon="calendar"
              title="Não foi possível carregar a semana"
              description="Atualize a página para tentar carregar os horários novamente."
            />
          ) : !professionals.data?.length ? (
            <EmptyState
              icon="user"
              title="Prepare quem vai atender"
              description={
                managed
                  ? "Cadastre um profissional para configurar os horários."
                  : "Ainda não há um profissional vinculado ao seu perfil. Peça ao proprietário para configurar seu acesso."
              }
            />
          ) : (
            professionals.data.map((professional) => (
              <section
                key={professional.id}
                className="availability-pro"
                aria-labelledby={`professional-${professional.id}`}
              >
                <h3 id={`professional-${professional.id}`}>
                  <span
                    className="availability-professional-avatar"
                    aria-hidden="true"
                  >
                    {professional.name.slice(0, 2).toLocaleUpperCase("pt-BR")}
                  </span>
                  {professional.name}
                  {professional.archived_at && <small> (arquivado)</small>}
                </h3>
                <ul className="availability-week">
                  {days.slice(1).map((day, index) => {
                    const dayShifts =
                      shifts.data?.filter(
                        (shift) =>
                          shift.professional_id === professional.id &&
                          shift.weekday === index + 1,
                      ) || [];
                    return (
                      <li key={day}>
                        <strong>{day}</strong>
                        <div className="availability-shifts">
                          {dayShifts.length ? (
                            dayShifts.map((shift) => (
                              <div
                                key={shift.id}
                                className="availability-shift"
                              >
                                <span>
                                  {time(shift.start_minute)}–
                                  {time(shift.end_minute)}
                                </span>
                                {managed && writable && (
                                  <form action={removeShift}>
                                    <input
                                      type="hidden"
                                      name="company_id"
                                      value={companyId}
                                    />
                                    <input
                                      type="hidden"
                                      name="id"
                                      value={shift.id}
                                    />
                                    <ConfirmSubmit
                                      label="Remover turno"
                                      description={`Remover o turno de ${professional.name}, ${day}, das ${time(shift.start_minute)} às ${time(shift.end_minute)}. Os agendamentos existentes serão preservados.`}
                                    />
                                  </form>
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="availability-off">
                              Sem atendimento
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </section>
        {managed && writable && (
          <form
            action={addShift}
            className="panel operations-form availability-add-form"
          >
            <span className="operations-icon">
              <Icon name="plus" size={18} />
            </span>
            <h2>Adicionar um turno</h2>
            <p>
              Para ajustar um horário, remova o turno anterior e adicione o
              novo.
            </p>
            <input type="hidden" name="company_id" value={companyId} />
            <label htmlFor="professional_id">Profissional</label>
            <select
              id="professional_id"
              name="professional_id"
              required
              defaultValue=""
            >
              <option value="">Selecione um profissional</option>
              {activeProfessionals.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name}
                </option>
              ))}
            </select>
            <label htmlFor="weekday">Dia da semana</label>
            <select id="weekday" name="weekday">
              {days.slice(1).map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </select>
            <div className="form-grid">
              <div>
                <label htmlFor="start">Começa às</label>
                <input
                  id="start"
                  name="start"
                  type="time"
                  required
                  defaultValue="08:00"
                />
              </div>
              <div>
                <label htmlFor="end">Termina às</label>
                <input
                  id="end"
                  name="end"
                  type="time"
                  required
                  defaultValue="18:00"
                />
              </div>
            </div>
            <p className="availability-help">
              Exemplo com almoço: um turno das 8h às 12h e outro das 13h às 18h.
            </p>
            <PendingButton>
              Adicionar turno <Icon name="plus" size={16} />
            </PendingButton>
          </form>
        )}
      </div>
      <section
        className="panel schedule-block-panel"
        id="bloqueios"
        aria-labelledby="schedule-block-heading"
      >
        <div className="schedule-block-heading">
          <div>
            <h2 id="schedule-block-heading">Bloqueios de agenda</h2>
            <p>
              {managed
                ? "Reserve folgas, feriados ou períodos sem atendimento para um profissional ou toda a empresa."
                : "Confira os períodos sem atendimento da empresa e do seu perfil."}{" "}
              Horários no fuso de São Paulo.
            </p>
          </div>
          <Link
            className="button secondary"
            href={`/painel/${companyId}/agenda`}
          >
            Abrir agenda
          </Link>
        </div>
        <form
          className="schedule-block-window"
          action={`/painel/${companyId}/disponibilidade#bloqueios`}
        >
          <label htmlFor="block-window-day">
            Consultar 30 dias a partir de
            <input
              id="block-window-day"
              type="date"
              name="bloqueios_de"
              min="1900-01-01"
              max="2099-12-31"
              defaultValue={blockDay}
              required
            />
          </label>
          <button className="secondary">Consultar bloqueios</button>
          <span>
            Até {blockLastDay.split("-").reverse().join("/")}, inclusive
          </span>
          {validDay(addDays(blockDay, -30)) && (
            <Link
              className="button secondary"
              href={blockHref(addDays(blockDay, -30))}
            >
              30 dias anteriores
            </Link>
          )}
          {validDay(addDays(blockDay, 30)) && (
            <Link
              className="button secondary"
              href={blockHref(addDays(blockDay, 30))}
            >
              Próximos 30 dias
            </Link>
          )}
        </form>
        {blocks.error || professionals.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar os bloqueios. Atualize a página para
            tentar novamente.
          </p>
        ) : (
          <ScheduleBlockList
            blocks={blocks.data ?? []}
            professionals={professionals.data ?? []}
            page={page}
            total={blocks.count ?? 0}
            pageHref={(target) => blockHref(blockDay, target)}
            removeAction={
              managed && writable
                ? removeScheduleBlock.bind(null, companyId)
                : undefined
            }
            windowDay={blockDay}
          />
        )}
        {managed && writable && !professionals.error && (
          <ScheduleBlockForm
            action={createScheduleBlock.bind(null, companyId)}
            requestId={randomUUID()}
            day={saoPauloDay()}
            companyId={companyId}
            professionals={activeProfessionals}
          />
        )}
      </section>
      {role === "OWNER" && (
        <>
          <section className="panel booking-settings" id="pagina-publica">
            <div className="workspace-section-heading">
              <div>
                <span className="tag">Página de agendamento</span>
                <h2>Apresente sua empresa</h2>
              </div>
              <span
                className={`operations-status${enabled ? " is-active" : ""}`}
              >
                {enabled ? "Página ativada" : "Página desativada"}
              </span>
            </div>
            <p>
              Essas informações aparecem para quem abre seu link de agendamento.
            </p>
            {writable ? (
              <form action={configureProfile} className="operations-form">
                <input type="hidden" name="company_id" value={companyId} />
                <div className="booking-profile-grid">
                  <div>
                    <label htmlFor="description">Uma breve apresentação</label>
                    <textarea
                      id="description"
                      name="description"
                      maxLength={240}
                      rows={3}
                      placeholder="Conte o que torna seu atendimento especial."
                      defaultValue={company.booking_description || ""}
                      aria-describedby="description-help"
                    />
                    <p id="description-help" className="field-help">
                      Até 240 caracteres. Evite incluir informações pessoais de
                      clientes.
                    </p>
                    <label htmlFor="address">
                      Endereço ou local de atendimento
                    </label>
                    <input
                      id="address"
                      name="address"
                      maxLength={200}
                      placeholder="Rua, número, bairro — cidade"
                      defaultValue={company.booking_address || ""}
                    />
                    <label htmlFor="phone">WhatsApp da empresa</label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      maxLength={24}
                      placeholder="DDD e número"
                      defaultValue={company.booking_phone || ""}
                      aria-describedby="phone-help"
                    />
                    <p id="phone-help" className="field-help">
                      Opcional. Esse número ficará público para seus clientes.
                    </p>
                    <fieldset className="booking-theme-options">
                      <legend>Cor da sua página</legend>
                      {themes.map((theme) => (
                        <label key={theme.value}>
                          <input
                            type="radio"
                            name="theme"
                            value={theme.value}
                            defaultChecked={
                              (company.booking_theme || "teal") === theme.value
                            }
                          />
                          <span
                            className="booking-theme-dot"
                            aria-hidden="true"
                            style={
                              { "--theme-color": theme.color } as CSSProperties
                            }
                          />
                          {theme.label}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  <aside
                    className="booking-profile-preview"
                    aria-label="Apresentação salva da empresa"
                  >
                    <span className="company-avatar" aria-hidden="true">
                      {company.name.slice(0, 2).toLocaleUpperCase("pt-BR")}
                    </span>
                    <h3>{company.name}</h3>
                    <p>
                      {company.booking_description ||
                        "Sua apresentação vai aparecer aqui após salvar."}
                    </p>
                    <p>
                      {company.booking_address || "Seu endereço de atendimento"}
                    </p>
                    <span className="booking-preview-label">
                      <Icon name="link" size={14} /> Apresentação salva
                    </span>
                  </aside>
                </div>
                <PendingButton>
                  Salvar apresentação <Icon name="check" size={16} />
                </PendingButton>
              </form>
            ) : (
              <p>
                Apresentação disponível para edição quando a assinatura estiver
                regularizada.
              </p>
            )}
          </section>
          <section className="panel booking-settings">
            <div className="operations-section-title">
              <span className="operations-icon">
                <Icon name="link" size={18} />
              </span>
              <h2>Publique e compartilhe</h2>
            </div>
            <p>
              Escolha o endereço da página. Ative quando seus serviços,
              profissionais e turnos estiverem preparados.
            </p>
            {writable && (
              <form action={configure} className="operations-form">
                <input type="hidden" name="company_id" value={companyId} />
                <label htmlFor="slug">Endereço da sua página</label>
                <input
                  id="slug"
                  name="slug"
                  minLength={3}
                  maxLength={60}
                  pattern="[a-z0-9][a-z0-9-]{2,59}"
                  defaultValue={company.booking_slug || ""}
                  placeholder="nome-da-sua-empresa"
                  required
                  aria-describedby="slug-help"
                />
                <p id="slug-help" className="field-help">
                  Use letras minúsculas, números e hífen. Alterar o endereço
                  torna o link anterior indisponível.
                </p>
                <label className="slot">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={company.booking_enabled}
                  />
                  Receber agendamentos pela página pública
                </label>
                <div>
                  <PendingButton>
                    Salvar publicação <Icon name="check" size={16} />
                  </PendingButton>
                </div>
              </form>
            )}
            {enabled && writable && (
              <ShareBooking url={publicUrl} companyName={company.name} />
            )}
          </section>
        </>
      )}
    </>
  );
}
