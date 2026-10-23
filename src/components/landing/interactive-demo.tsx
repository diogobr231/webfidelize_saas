"use client";

import Image from "next/image";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { demoIdentity } from "./demo-identity";
import {
  createDemoAppointment,
  demoClients,
  demoProfessionals,
  demoTimes,
  type DemoAppointment,
} from "@/lib/segments";

type DemoTab = "booking" | "agenda" | "cliente";
type Feedback = { error?: string; success?: string };
const tabs = [
  { id: "booking", label: "Página de agendamento", icon: "link" },
  { id: "agenda", label: "Agenda", icon: "calendar" },
  { id: "cliente", label: "Ficha do cliente", icon: "users" },
] as const;

function DemoFeedback({ feedback }: { feedback: Feedback }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {feedback.error ? (
        <p className="demo-feedback error" role="alert">
          {feedback.error}
        </p>
      ) : null}
      {feedback.success ? (
        <p className="demo-feedback" role="status">
          {feedback.success}
        </p>
      ) : null}
    </div>
  );
}

export function InteractiveDemo({
  services,
  segmentSlug,
  segmentName,
}: {
  services: readonly string[];
  segmentSlug: string;
  segmentName: string;
}) {
  const initial: DemoAppointment[] = [
    {
      id: "initial",
      client: demoClients[0],
      professional: demoProfessionals[0],
      service: services[0],
      time: "10:00",
    },
  ];
  const identity = demoIdentity(segmentSlug);
  const [appointments, setAppointments] = useState(initial);
  const [tab, setTab] = useState<DemoTab>("booking");
  const [client, setClient] = useState<string>(demoClients[0]);
  const [professional, setProfessional] = useState<string>(
    demoProfessionals[0],
  );
  const [service, setService] = useState(services[0]);
  const [time, setTime] = useState<string>("11:00");
  const [feedback, setFeedback] = useState<Feedback>({});
  const [coverUnavailable, setCoverUnavailable] = useState(false);
  const tabList = useRef<HTMLDivElement>(null);
  const clientAppointments = appointments.filter(
    (item) => item.client === client,
  );
  const isOccupied = (slot: string, selectedProfessional = professional) =>
    appointments.some(
      (item) =>
        item.professional === selectedProfessional && item.time === slot,
    );

  function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = createDemoAppointment(
      appointments,
      { client, professional, service, time },
      services,
    );
    if ("error" in result) {
      setFeedback({ error: result.error });
      return;
    }
    setAppointments(result.appointments);
    setFeedback({
      success: `Agendamento de exemplo adicionado às ${time}. Nenhuma reserva real foi criada. Veja o resultado na Agenda e na Ficha do cliente.`,
    });
    if (tab === "booking") {
      setTime(
        demoTimes.find(
          (slot) =>
            !result.appointments.some(
              (item) =>
                item.professional === professional && item.time === slot,
            ),
        ) ?? "",
      );
    }
  }

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabList.current
      ?.querySelectorAll<HTMLButtonElement>("button")
      [next]?.focus();
  }

  return (
    <section className="demo-workspace" aria-label="Demonstração interativa">
      <div className="demo-toolbar">
        <div>
          <Icon name="sparkles" />
          <strong>Seu negócio, com a sua identidade</strong>
        </div>
        <span>Somente exemplos</span>
      </div>
      <div
        className="demo-tabs"
        role="tablist"
        aria-label="Visualizações da demonstração"
        ref={tabList}
      >
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`demo-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`demo-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="demo-body">
        <div className="demo-context">
          <span>Dia ilustrativo · horários de exemplo</span>
          <button
            type="button"
            className="demo-reset"
            onClick={() => {
              setAppointments(initial);
              setClient(demoClients[0]);
              setProfessional(demoProfessionals[0]);
              setService(services[0]);
              setTime("11:00");
              setFeedback({
                success:
                  "Demonstração reiniciada. Nenhum dado real foi alterado.",
              });
            }}
          >
            Reiniciar exemplo
          </button>
        </div>
        <div
          role="tabpanel"
          id={`demo-panel-${tab}`}
          aria-labelledby={`demo-tab-${tab}`}
          tabIndex={0}
        >
          {tab === "booking" ? (
            <section
              className="demo-booking"
              aria-label="Exemplo da página pública da empresa"
            >
              <figure className="demo-booking-cover">
                {coverUnavailable ? (
                  <div className="demo-cover-fallback">
                    <Icon name="building" size={35} />
                    <strong>O seu espaço começa aqui.</strong>
                    <span>Sua foto dará as boas-vindas aos seus clientes.</span>
                  </div>
                ) : (
                  <Image
                    src="/demo/espaco-ilustrativo.png"
                    alt="Recepção ilustrativa para a demonstração da página de agendamento"
                    width={1536}
                    height={1024}
                    sizes="(max-width: 540px) 85vw, (max-width: 1240px) 90vw, 1110px"
                    onError={() => setCoverUnavailable(true)}
                  />
                )}
                <figcaption>
                  Imagem ilustrativa. Sua empresa usa sua própria foto.
                </figcaption>
              </figure>
              <header className="demo-booking-identity">
                <div
                  className="demo-business-logo"
                  role="img"
                  aria-label={`Logo ilustrativa: ${identity.initials}`}
                >
                  <span>{identity.initials}</span>
                  <Icon name={identity.icon} size={20} />
                </div>
                <div className="demo-business-intro">
                  <span className="demo-identity-label">
                    Marca ilustrativa · {segmentName}
                  </span>
                  <h2>{identity.name}</h2>
                  <p>
                    Escolha um serviço e encontre um horário. Assim seu cliente
                    conhece o espaço e experimenta agendar pelo seu link.
                  </p>
                </div>
                <span className="demo-booking-badge">
                  <Icon name="calendar" size={15} />
                  Agendamento online
                </span>
              </header>
              <form
                className="demo-booking-form"
                aria-label="Experimentar uma reserva online"
                onSubmit={submitAppointment}
              >
                <div className="demo-booking-options">
                  <fieldset className="demo-service-options">
                    <legend>
                      <span className="demo-step">1</span>Escolha um serviço
                    </legend>
                    <p className="demo-field-hint">
                      Opções ilustrativas para conhecer a experiência.
                    </p>
                    <div className="demo-service-grid">
                      {services.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="demo-service-choice"
                          aria-pressed={service === item}
                          onClick={() => {
                            setService(item);
                            setFeedback({});
                          }}
                        >
                          <span className="demo-service-icon">
                            <Icon name={identity.icon} size={22} />
                          </span>
                          <strong>{item}</strong>
                          <small>
                            <Icon name="clock" size={14} />
                            30 min · exemplo
                          </small>
                          <span
                            className="demo-service-check"
                            aria-hidden="true"
                          >
                            {service === item ? (
                              <Icon name="check" size={15} />
                            ) : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="demo-schedule-options">
                    <legend>
                      <span className="demo-step">2</span>Escolha quem atende e
                      o horário
                    </legend>
                    <label htmlFor="booking-demo-professional">
                      Profissional de exemplo
                    </label>
                    <select
                      id="booking-demo-professional"
                      value={professional}
                      onChange={(event) => {
                        const selected = event.target.value;
                        setProfessional(selected);
                        setTime(
                          demoTimes.find(
                            (slot) => !isOccupied(slot, selected),
                          ) ?? "",
                        );
                        setFeedback({});
                      }}
                    >
                      {demoProfessionals.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                    <fieldset className="demo-time-options">
                      <legend>Horário de exemplo</legend>
                      <p className="demo-field-hint">
                        Dia ilustrativo. Os horários ocupados acompanham a
                        agenda deste exemplo.
                      </p>
                      <div className="demo-time-grid">
                        {demoTimes.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            aria-pressed={time === slot}
                            disabled={isOccupied(slot)}
                            aria-label={`${slot}${isOccupied(slot) ? ", ocupado no exemplo" : ", disponível no exemplo"}`}
                            onClick={() => {
                              setTime(slot);
                              setFeedback({});
                            }}
                          >
                            <span>{slot}</span>
                            <small>
                              {isOccupied(slot) ? "Ocupado" : "Disponível"}
                            </small>
                          </button>
                        ))}
                      </div>
                      {!time ? (
                        <p className="demo-field-hint">
                          Os horários deste profissional foram preenchidos no
                          exemplo. Escolha outro profissional ou reinicie a
                          demonstração.
                        </p>
                      ) : null}
                    </fieldset>
                  </fieldset>
                </div>
                <aside
                  className="demo-booking-summary"
                  aria-labelledby="demo-summary-title"
                >
                  <span className="experience-eyebrow">SUA ESCOLHA</span>
                  <h3 id="demo-summary-title">Quase tudo pronto.</h3>
                  <dl>
                    <div>
                      <dt>Serviço</dt>
                      <dd>{service}</dd>
                    </div>
                    <div>
                      <dt>Profissional</dt>
                      <dd>{professional}</dd>
                    </div>
                    <div>
                      <dt>Horário ilustrativo</dt>
                      <dd>{time || "Escolha outro profissional"}</dd>
                    </div>
                  </dl>
                  <label htmlFor="booking-demo-client">
                    Cliente de exemplo
                  </label>
                  <select
                    id="booking-demo-client"
                    value={client}
                    onChange={(event) => {
                      setClient(event.target.value);
                      setFeedback({});
                    }}
                  >
                    {demoClients.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <p className="demo-private-note">
                    <Icon name="shield" size={17} />
                    Use os contatos fictícios. Não informe dados pessoais.
                  </p>
                  <button
                    type="submit"
                    className="demo-booking-submit"
                    disabled={!time}
                  >
                    Confirmar agendamento de exemplo
                    <Icon name="arrow-right" size={17} />
                  </button>
                  <DemoFeedback feedback={feedback} />
                  {feedback.success ? (
                    <button
                      type="button"
                      className="demo-see-agenda"
                      onClick={() => {
                        setTab("agenda");
                        tabList.current
                          ?.querySelectorAll<HTMLButtonElement>("button")[1]
                          ?.focus();
                      }}
                    >
                      Ver resultado na agenda
                      <Icon name="arrow-right" size={16} />
                    </button>
                  ) : null}
                  <small>
                    Nenhuma reserva real ou cobrança é feita nesta demonstração.
                  </small>
                </aside>
              </form>
              <div className="demo-brand-tip">
                <Icon name="sparkles" size={19} />
                <p>
                  <strong>Na sua página, a identidade é sua.</strong>{" "}
                  Personalize a logo, a foto do espaço, as cores e as
                  informações da sua empresa nas configurações.
                </p>
              </div>
            </section>
          ) : tab === "agenda" ? (
            <div className="demo-columns">
              <section aria-labelledby="demo-agenda-title">
                <h2 id="demo-agenda-title">Uma agenda fácil de acompanhar.</h2>
                <p>
                  Crie um atendimento de exemplo. Tente repetir o horário para
                  ver a prevenção de conflitos.
                </p>
                <ul className="demo-events">
                  {appointments.map((item) => (
                    <li key={item.id}>
                      <time>{item.time}</time>
                      <div>
                        <strong>{item.service}</strong>
                        <span>{item.client}</span>
                        <small>{item.professional} · 30 min</small>
                      </div>
                      <span className="demo-event-status">Exemplo</span>
                    </li>
                  ))}
                </ul>
              </section>
              <form onSubmit={submitAppointment} className="demo-form">
                <h2>Experimente agendar</h2>
                <p>
                  Use os contatos fictícios abaixo. Não informe dados pessoais.
                </p>
                <label htmlFor="demo-client">Cliente de exemplo</label>
                <select
                  id="demo-client"
                  value={client}
                  onChange={(event) => setClient(event.target.value)}
                >
                  {demoClients.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <label htmlFor="demo-professional">
                  Profissional de exemplo
                </label>
                <select
                  id="demo-professional"
                  value={professional}
                  onChange={(event) => setProfessional(event.target.value)}
                >
                  {demoProfessionals.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <label htmlFor="demo-service">Serviço de exemplo</label>
                <select
                  id="demo-service"
                  value={service}
                  onChange={(event) => setService(event.target.value)}
                >
                  {services.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <label htmlFor="demo-time">Horário de exemplo</label>
                <select
                  id="demo-time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                >
                  {!time ? <option value="">Escolha um horário</option> : null}
                  {demoTimes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <button type="submit">
                  Criar agendamento de exemplo
                  <Icon name="arrow-right" size={16} />
                </button>
                <DemoFeedback feedback={feedback} />
              </form>
            </div>
          ) : (
            <section className="demo-client-card">
              <span className="experience-eyebrow">FICHA ILUSTRATIVA</span>
              <h2>{client}</h2>
              <p>
                Consulte os atendimentos deste cliente criados nesta
                demonstração.
              </p>
              <ul className="demo-events">
                {clientAppointments.map((item) => (
                  <li key={item.id}>
                    <time>{item.time}</time>
                    <div>
                      <strong>{item.service}</strong>
                      <span>{item.professional}</span>
                      <small>Agendamento de exemplo · dia ilustrativo</small>
                    </div>
                  </li>
                ))}
              </ul>
              {clientAppointments.length === 0 ? (
                <p>Ainda não há atendimentos de exemplo para este cliente.</p>
              ) : null}
              <DemoFeedback feedback={feedback} />
            </section>
          )}
        </div>
      </div>
      <noscript>
        <p className="demo-feedback">
          Ative o JavaScript para interagir com os exemplos. Os benefícios e
          planos continuam disponíveis pelos links da página.
        </p>
      </noscript>
    </section>
  );
}
