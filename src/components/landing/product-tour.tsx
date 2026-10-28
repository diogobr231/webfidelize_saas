import { Icon } from "@/components/ui/icon";
import "./product-tour.css";

/** Native radio navigation keeps this illustrative tour usable without JavaScript. */
export function ProductTour() {
  return (
    <figure className="wf-tour" aria-labelledby="tour-caption">
      <div className="wf-tour-window">
        <div className="wf-tour-top">
          <span>
            <span className="wf-tour-mark" aria-hidden="true">
              <Icon name="calendar" size={18} />
            </span>{" "}
            Seu espaço de trabalho
          </span>
          <span className="wf-tour-demo">Demonstração</span>
        </div>
        <fieldset className="wf-tour-selector">
          <legend>Explore três partes da sua rotina</legend>
          <input
            type="radio"
            name="product-tour"
            id="tour-agenda"
            aria-controls="tour-agenda-panel"
            defaultChecked
          />
          <label htmlFor="tour-agenda">
            <Icon name="calendar" size={16} /> Agenda
          </label>
          <input
            type="radio"
            name="product-tour"
            id="tour-clientes"
            aria-controls="tour-clientes-panel"
          />
          <label htmlFor="tour-clientes">
            <Icon name="users" size={16} /> Clientes
          </label>
          <input
            type="radio"
            name="product-tour"
            id="tour-link"
            aria-controls="tour-link-panel"
          />
          <label htmlFor="tour-link">
            <Icon name="link" size={16} /> Seu link
          </label>
          <div className="wf-tour-panels">
            <section
              className="wf-tour-panel wf-tour-agenda"
              id="tour-agenda-panel"
              aria-label="Exemplo da agenda"
            >
              <div className="wf-tour-heading">
                <div>
                  <span>VISÃO DO DIA</span>
                  <h2>Cada horário, no seu lugar.</h2>
                </div>
                <Icon name="calendar" />
              </div>
              <div className="wf-tour-context">
                <span>Dia ilustrativo</span>
                <span>Profissional de exemplo</span>
              </div>
              <div className="wf-tour-timeline">
                <div>
                  <time>09:00</time>
                  <article className="wf-tour-event">
                    <span>Agendado</span>
                    <strong>Serviço de exemplo</strong>
                    <small>Cliente fictício A · 30 min</small>
                  </article>
                </div>
                <div>
                  <time>10:00</time>
                  <article className="wf-tour-event wf-tour-event-violet">
                    <span>Agendado</span>
                    <strong>Serviço de exemplo</strong>
                    <small>Cliente fictício B · 45 min</small>
                  </article>
                </div>
                <div>
                  <time>12:00</time>
                  <article className="wf-tour-break">
                    <Icon name="clock" size={16} />
                    <span>Intervalo configurado</span>
                  </article>
                </div>
              </div>
              <p className="wf-tour-insight">
                <Icon name="check" size={16} /> Consulte horários, remarque e
                bloqueie períodos pelo painel.
              </p>
            </section>
            <section
              className="wf-tour-panel wf-tour-customers"
              id="tour-clientes-panel"
              aria-label="Exemplo da ficha de cliente"
            >
              <div className="wf-tour-heading">
                <div>
                  <span>FICHA DO CLIENTE</span>
                  <h2>O histórico sempre por perto.</h2>
                </div>
                <Icon name="users" />
              </div>
              <div className="wf-tour-customer">
                <span aria-hidden="true">CE</span>
                <div>
                  <strong>Cliente de exemplo</strong>
                  <small>Contato e atendimentos no mesmo lugar</small>
                </div>
              </div>
              <h3 className="wf-tour-subheading">Histórico ilustrativo</h3>
              <div className="wf-tour-history">
                <Icon name="calendar" size={18} />
                <div>
                  <strong>Serviço de exemplo</strong>
                  <span>Profissional de exemplo · 30 min</span>
                </div>
                <span>Concluído</span>
              </div>
              <div className="wf-tour-history">
                <Icon name="calendar" size={18} />
                <div>
                  <strong>Serviço de exemplo</strong>
                  <span>Profissional de exemplo · 45 min</span>
                </div>
                <span className="wf-tour-status-canceled">Cancelado</span>
              </div>
              <p className="wf-tour-insight">
                <Icon name="check" size={16} /> Busque clientes pelo nome e
                consulte seus atendimentos.
              </p>
            </section>
            <section
              className="wf-tour-panel wf-tour-booking"
              id="tour-link-panel"
              aria-label="Exemplo da página pública"
            >
              <div className="wf-tour-heading">
                <div>
                  <span>SUA PÁGINA DE AGENDAMENTO</span>
                  <h2>Um link que facilita a reserva.</h2>
                </div>
                <Icon name="link" />
              </div>
              <div className="wf-tour-booking-brand">
                <span aria-hidden="true">EF</span>
                <div>
                  <strong>Espaço Fictício</strong>
                  <small>Sua marca recebe o cliente</small>
                </div>
              </div>
              <div className="wf-tour-booking-service">
                <div>
                  <strong>Serviço de exemplo</strong>
                  <small>30 min · profissional de exemplo</small>
                </div>
                <Icon name="check" size={18} />
              </div>
              <p className="wf-tour-subheading">
                Exemplo de horários disponíveis
              </p>
              <div
                className="wf-tour-slots"
                aria-label="Horários ilustrativos, sem reserva"
              >
                <span>09:00</span>
                <span>09:30</span>
                <span>10:00</span>
              </div>
              <p className="wf-tour-insight">
                <Icon name="check" size={16} /> Seu cliente agenda pelo
                navegador, sem criar uma conta.
              </p>
            </section>
          </div>
        </fieldset>
      </div>
      <figcaption id="tour-caption">
        Demonstração ilustrativa de recursos disponíveis, com dados fictícios.
        Nenhuma reserva é criada aqui.
      </figcaption>
    </figure>
  );
}
