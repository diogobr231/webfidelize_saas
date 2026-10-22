"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  createDemoAppointment,
  demoClients,
  demoProfessionals,
  demoTimes,
  type DemoAppointment,
} from "@/lib/segments";

export function InteractiveDemo({ services }: { services: readonly string[] }) {
  const initial: DemoAppointment[] = [
    {
      id: "initial",
      client: demoClients[0],
      professional: demoProfessionals[0],
      service: services[0],
      time: "10:00",
    },
  ];
  const [appointments, setAppointments] = useState(initial);
  const [tab, setTab] = useState("agenda");
  const [client, setClient] = useState<string>(demoClients[0]);
  const [professional, setProfessional] = useState<string>(
    demoProfessionals[0],
  );
  const [service, setService] = useState(services[0]);
  const [time, setTime] = useState<string>("11:00");
  const [feedback, setFeedback] = useState<{
    error?: string;
    success?: string;
  }>({});
  return (
    <section className="demo-workspace" aria-label="Demonstração interativa">
      <div className="demo-toolbar">
        <div>
          <Icon name="calendar" />
          <strong>Seu espaço de trabalho</strong>
        </div>
        <span>Somente exemplos</span>
      </div>
      <div className="demo-tabs" aria-label="Visualizações da demonstração">
        <button
          type="button"
          aria-pressed={tab === "agenda"}
          onClick={() => setTab("agenda")}
        >
          <Icon name="calendar" size={17} />
          Agenda
        </button>
        <button
          type="button"
          aria-pressed={tab === "cliente"}
          onClick={() => setTab("cliente")}
        >
          <Icon name="users" size={17} />
          Ficha do cliente
        </button>
      </div>
      <div className="demo-body">
        <div className="demo-context">
          <span>Dia ilustrativo · horários de exemplo</span>
          <button
            type="button"
            className="demo-reset"
            onClick={() => {
              setAppointments(initial);
              setFeedback({
                success:
                  "Demonstração reiniciada. Nenhum dado real foi alterado.",
              });
            }}
          >
            Reiniciar exemplo
          </button>
        </div>
        {tab === "agenda" ? (
          <div className="demo-columns">
            <section aria-labelledby="demo-agenda-title">
              <h2 id="demo-agenda-title">Uma agenda fácil de acompanhar.</h2>
              <p>
                Crie um atendimento de exemplo. Tente repetir o horário para ver
                a prevenção de conflitos.
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
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const result = createDemoAppointment(
                  appointments,
                  { client, professional, service, time },
                  services,
                );
                if ("error" in result) setFeedback({ error: result.error });
                else {
                  setAppointments(result.appointments);
                  setFeedback({
                    success: `Agendamento de exemplo adicionado às ${time}. Nenhuma reserva real foi criada.`,
                  });
                }
              }}
              className="demo-form"
            >
              <h2>Experimente agendar</h2>
              <p>
                Use os contatos fictícios abaixo. Não informe dados pessoais.
              </p>
              <label htmlFor="demo-client">Cliente de exemplo</label>
              <select
                id="demo-client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              >
                {demoClients.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <label htmlFor="demo-professional">Profissional de exemplo</label>
              <select
                id="demo-professional"
                value={professional}
                onChange={(e) => setProfessional(e.target.value)}
              >
                {demoProfessionals.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <label htmlFor="demo-service">Serviço de exemplo</label>
              <select
                id="demo-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
              >
                {services.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <label htmlFor="demo-time">Horário de exemplo</label>
              <select
                id="demo-time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              >
                {demoTimes.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <button type="submit">
                Criar agendamento de exemplo{" "}
                <Icon name="arrow-right" size={16} />
              </button>
            </form>
          </div>
        ) : (
          <section className="demo-client-card">
            <span className="experience-eyebrow">FICHA ILUSTRATIVA</span>
            <h2>{client}</h2>
            <p>
              Consulte os atendimentos deste cliente criados nesta demonstração.
            </p>
            <ul className="demo-events">
              {appointments
                .filter((item) => item.client === client)
                .map((item) => (
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
            {!appointments.some((item) => item.client === client) ? (
              <p>Ainda não há atendimentos de exemplo para este cliente.</p>
            ) : null}
          </section>
        )}
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
