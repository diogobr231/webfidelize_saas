"use client";

import { useActionState, useId } from "react";
import { PendingButton } from "@/components/pending-button";
import { money } from "@/lib/catalog";
import { appointmentTime } from "@/lib/scheduling";
import type { ClassFormState, PublicClass } from "@/lib/classes";
import type { ClassAction } from "./class-form";

const initial: ClassFormState = {};
export function PublicClassReservationForm({
  session,
  action,
  requestId,
}: {
  session: PublicClass;
  action: ClassAction;
  requestId: string;
}) {
  const [state, submit] = useActionState(action, initial);
  const id = useId();
  return (
    <form
      action={submit}
      className="class-form public-class-reservation"
      onReset={(event) => event.preventDefault()}
    >
      <input name="session" type="hidden" value={session.id} />
      <input name="request_id" type="hidden" value={requestId} />
      <div className="class-reservation-summary">
        <span>Sua inscrição</span>
        <h3>{session.title}</h3>
        <p>
          {session.service.name} · {session.professional.name}
        </p>
        <p>
          {new Date(session.starts_at).toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "long",
          })}{" "}
          · {appointmentTime(session.starts_at)} às{" "}
          {appointmentTime(session.ends_at)}
        </p>
        <strong>
          {money(session.service.price_cents)} <small>por participante</small>
        </strong>
      </div>
      <label htmlFor={`${id}-name`}>
        Seu nome
        <input
          id={`${id}-name`}
          name="customer_name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="Nome e sobrenome"
        />
      </label>
      <label htmlFor={`${id}-phone`}>
        Telefone com DDD
        <input
          id={`${id}-phone`}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          minLength={10}
          maxLength={30}
          placeholder="(11) 99999-9999"
        />
      </label>
      <div className="booking-honeypot" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Deixe em branco</label>
        <input
          id={`${id}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>
      <label className="class-checkbox">
        <input name="consent" type="checkbox" required />
        <span>
          Autorizo o uso do meu nome e telefone pela empresa para organizar esta
          inscrição.
        </span>
      </label>
      <p className="class-help">
        A vaga é confirmada após o envio. Nenhum pagamento é solicitado nesta
        página. Para alterar ou cancelar, fale com a empresa. Não informe dados
        de saúde.
      </p>
      {state.error && (
        <p role="alert" className="notice error">
          {state.error}
        </p>
      )}
      <PendingButton pendingLabel="Reservando sua vaga…">
        Confirmar inscrição
      </PendingButton>
    </form>
  );
}
