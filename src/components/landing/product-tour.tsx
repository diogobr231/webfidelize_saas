import { Icon } from "@/components/ui/icon";
import Image from "next/image";
import "./product-tour.css";

/** Native radio navigation keeps this illustrative tour usable without JavaScript. */
export function ProductTour() {
  return (
    <figure className="wf-tour" aria-labelledby="tour-caption">
      <div className="wf-tour-window">
        <div className="wf-tour-top">
          <span>
            <span className="wf-tour-mark" aria-hidden="true">
              <Image
                src="/webfidelize-logo.png"
                alt="Web Fidelize"
                width="160"
                height="53"
                decoding="async"
                sizes="74px"
              />
            </span>{" "}
            Seu espaço de trabalho
          </span>
          <span className="wf-tour-demo">Demonstração</span>
        </div>
        <div className="wf-tour-office">
          <Image
            src="/demo/photos/office-interior.webp"
            alt="Escritório ilustrativo com estações de trabalho; foto de banco de imagens"
            width="1000"
            height="667"
            decoding="async"
            sizes="(max-width: 760px) 90vw, 50vw"
            preload
          />
          <div>
            <span>
              <Icon name="briefcase" size={15} /> AURORA · ESCRITÓRIO FICTÍCIO
            </span>
            <strong>Sua rotina, com mais espaço.</strong>
            <small>Foto ilustrativa · Nastuh Abootalebi / Unsplash</small>
          </div>
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
                <span>Marina · demonstração</span>
              </div>
              <div className="wf-tour-timeline">
                <div>
                  <time>09:00</time>
                  <article className="wf-tour-event">
                    <span>Agendado</span>
                    <strong>Reunião de planejamento</strong>
                    <small>Ana · cliente fictícia · 30 min</small>
                  </article>
                </div>
                <div>
                  <time>10:00</time>
                  <article className="wf-tour-event wf-tour-event-violet">
                    <span>Agendado</span>
                    <strong>Consultoria de negócios</strong>
                    <small>Lucas · cliente fictício · 45 min</small>
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
                  <strong>Ana · cliente fictícia</strong>
                  <small>Contato e atendimentos no mesmo lugar</small>
                </div>
              </div>
              <h3 className="wf-tour-subheading">Histórico ilustrativo</h3>
              <div className="wf-tour-history">
                <Icon name="calendar" size={18} />
                <div>
                  <strong>Reunião de planejamento</strong>
                  <span>Marina · demonstração · 30 min</span>
                </div>
                <span>Concluído</span>
              </div>
              <div className="wf-tour-history">
                <Icon name="calendar" size={18} />
                <div>
                  <strong>Consultoria de negócios</strong>
                  <span>Marina · demonstração · 45 min</span>
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
                  <strong>Aurora · escritório fictício</strong>
                  <small>Sua marca recebe o cliente</small>
                </div>
              </div>
              <div className="wf-tour-booking-service">
                <div>
                  <strong>Reunião de planejamento</strong>
                  <small>30 min · Marina (demonstração)</small>
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
