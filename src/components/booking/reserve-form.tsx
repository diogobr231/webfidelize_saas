"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { money } from "@/lib/catalog";
import { reserve } from "@/app/agendar/[slug]/actions";
import { Icon } from "@/components/ui/icon";
import { CepAddressInput } from "@/components/cep-address-input";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="booking-button"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? "Confirmando seu agendamento…" : "Confirmar agendamento"}
      {!pending ? (
        <Icon name="arrow-right" size={17} />
      ) : (
        <span className="booking-spinner" aria-hidden="true" />
      )}
    </button>
  );
}

export function ReserveForm({
  slug,
  service,
  professional,
  day,
  slots,
  requestId,
  niche,
}: {
  slug: string;
  service: { id: string; name: string; duration: number; price_cents: number };
  professional: { id: string; name: string };
  day: string;
  slots: { starts_at: string }[];
  requestId: string;
  niche: string;
}) {
  const [start, setStart] = useState("");
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  const date = new Date(`${day}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <form action={reserve} className="booking-reservation">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="service" value={service.id} />
      <input type="hidden" name="professional" value={professional.id} />
      <input type="hidden" name="request_id" value={requestId} />
      <section className="booking-card" id="horarios">
        <div className="booking-section-heading">
          <span className="booking-step-number">2</span>
          <div>
            <h2>Um horário que combina com você</h2>
            <p>{date} · horário de São Paulo</p>
          </div>
        </div>
        <fieldset className="booking-fieldset">
          <legend className="booking-sr-only">Horários disponíveis</legend>
          <div className="booking-slots">
            {slots.map((slot) => (
              <label className="booking-time" key={slot.starts_at}>
                <input
                  type="radio"
                  name="start_time"
                  value={slot.starts_at}
                  required
                  checked={start === slot.starts_at}
                  onChange={() => setStart(slot.starts_at)}
                />
                <span>{time(slot.starts_at)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="booking-small">
          O horário será reservado quando você confirmar abaixo.
        </p>
      </section>
      <section className="booking-card" id="seus-dados">
        <div className="booking-section-heading">
          <span className="booking-step-number">3</span>
          <div>
            <h2>Quase pronto. Como podemos chamar você?</h2>
            <p>A empresa usa estes dados para organizar seu atendimento.</p>
          </div>
        </div>
        <div className="booking-fields">
          <div>
            <label htmlFor="customer_name">Seu nome</label>
            <input
              id="customer_name"
              name="customer_name"
              minLength={2}
              maxLength={120}
              autoComplete="name"
              placeholder="Nome e sobrenome"
              required
            />
          </div>
          <div>
            <label htmlFor="phone">WhatsApp com DDD</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              minLength={10}
              maxLength={30}
              autoComplete="tel"
              placeholder="(11) 99999-9999"
              required
            />
          </div>
        </div>
        {niche === "fornecedores" || niche === "logistica" ? (
          <div className="booking-fields booking-niche-fields">
            <CepAddressInput
              id="delivery_location"
              name="delivery_location"
              label="Endereço ou link do Google Maps (opcional)"
              maxLength={500}
              placeholder="Rua, número, bairro ou link do Maps"
              helper="Use a busca por CEP ou cole um link do Maps. Confira número, complemento e se a empresa atende a região. Só a empresa verá este dado."
            />
          </div>
        ) : null}
        {niche === "pet-shop" ? (
          <div className="booking-fields booking-niche-fields">
            <div>
              <label htmlFor="pet_name">Nome do pet</label>
              <input
                id="pet_name"
                name="pet_name"
                minLength={2}
                maxLength={80}
                autoComplete="off"
                placeholder="Como ele se chama?"
                required
              />
            </div>
            <div>
              <label htmlFor="pet_species">Espécie</label>
              <select
                id="pet_species"
                name="pet_species"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Selecione
                </option>
                <option value="dog">Cão</option>
                <option value="cat">Gato</option>
                <option value="other">Outro</option>
              </select>
            </div>
            <div>
              <label htmlFor="pet_size">
                Porte <span>(opcional)</span>
              </label>
              <select id="pet_size" name="pet_size" defaultValue="">
                <option value="">Não informar</option>
                <option value="small">Pequeno</option>
                <option value="medium">Médio</option>
                <option value="large">Grande</option>
              </select>
            </div>
            <small>
              Dados básicos para organizar o atendimento. Não inclua informações
              de saúde.
            </small>
          </div>
        ) : null}
        {niche === "escritorio" ? (
          <div className="booking-fields booking-niche-fields">
            <div>
              <label htmlFor="meeting_topic">
                Assunto da reunião <span>(opcional)</span>
              </label>
              <input
                id="meeting_topic"
                name="meeting_topic"
                maxLength={120}
                placeholder="Ex.: conversa inicial"
              />
            </div>
          </div>
        ) : null}
        <div className="booking-honeypot" aria-hidden="true">
          <label htmlFor="website">Deixe em branco</label>
          <input
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
        <div className="booking-summary" aria-live="polite" aria-atomic="true">
          <div className="booking-summary-heading">
            <span>
              <Icon name="calendar" size={15} />
              Seu agendamento
            </span>
            <strong>{money(service.price_cents)}</strong>
          </div>
          <strong>{service.name}</strong>
          <p>
            {professional.name} · {service.duration} minutos
          </p>
          <p>
            {date}
            {start ? ` às ${time(start)}` : " · escolha um horário acima"}
          </p>
        </div>
        <label className="booking-consent">
          <input name="consent" type="checkbox" required />
          <span>
            Autorizo o uso do meu nome e telefone pela empresa para organizar
            este agendamento.
          </span>
        </label>
        <p className="booking-small">
          Não inclua informações de saúde. Nenhum pagamento é solicitado nesta
          reserva.
        </p>
        <label className="booking-consent">
          <input name="whatsapp_consent" type="checkbox" />
          <span>
            Quero receber lembretes deste agendamento pelo WhatsApp informado,
            quando disponíveis. É opcional e posso deixar de receber depois.
          </span>
        </label>
        <ConfirmButton />
      </section>
    </form>
  );
}
