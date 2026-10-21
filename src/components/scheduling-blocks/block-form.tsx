"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ScheduleBlockState } from "@/lib/schedule-blocks";

export function ScheduleBlockForm({
  action,
  requestId,
  day,
  companyId,
  professionals,
}: {
  action: (
    previous: ScheduleBlockState,
    form: FormData,
  ) => Promise<ScheduleBlockState>;
  requestId: string;
  day: string;
  companyId: string;
  professionals: { id: string; name: string }[];
}) {
  const [state, submit, pending] = useActionState(
    action,
    {},
    `/painel/${companyId}/disponibilidade`,
  );
  const values = state.values;
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.feedbackKey) errorRef.current?.focus();
  }, [state.feedbackKey]);
  return (
    <form
      action={submit}
      className="schedule-block-form"
      aria-busy={pending}
      key={state.feedbackKey}
    >
      <input
        type="hidden"
        name="request_id"
        value={values?.request_id ?? requestId}
      />
      <h3>Reservar um período sem atendimento</h3>
      <p id="schedule-block-hint">
        Use para folgas, férias, feriados ou compromissos. Um bloqueio impede
        novas reservas e remarcações nesse intervalo.
      </p>
      {state.error && (
        <p className="notice error" role="alert" tabIndex={-1} ref={errorRef}>
          {state.error}
        </p>
      )}
      <label htmlFor="block-professional">Quem ficará indisponível?</label>
      <select
        id="block-professional"
        name="professional_id"
        defaultValue={values?.professional_id ?? ""}
        aria-describedby="schedule-block-hint"
        disabled={pending}
      >
        <option value="">Toda a empresa</option>
        {professionals.map((professional) => (
          <option key={professional.id} value={professional.id}>
            {professional.name}
          </option>
        ))}
      </select>
      <div className="schedule-block-dates">
        <fieldset>
          <legend>Início do bloqueio</legend>
          <label htmlFor="block-start-day">Data de início</label>
          <input
            id="block-start-day"
            name="start_day"
            type="date"
            min="1900-01-01"
            max="2099-12-31"
            required
            defaultValue={values?.start_day ?? day}
            readOnly={pending}
          />
          <label htmlFor="block-start-time">Hora de início</label>
          <input
            id="block-start-time"
            name="start_time"
            type="time"
            required
            defaultValue={values?.start_time ?? "08:00"}
            readOnly={pending}
          />
        </fieldset>
        <fieldset>
          <legend>Fim do bloqueio</legend>
          <label htmlFor="block-end-day">Data de término</label>
          <input
            id="block-end-day"
            name="end_day"
            type="date"
            min="1900-01-01"
            max="2099-12-31"
            required
            defaultValue={values?.end_day ?? day}
            readOnly={pending}
          />
          <label htmlFor="block-end-time">Hora de término</label>
          <input
            id="block-end-time"
            name="end_time"
            type="time"
            required
            defaultValue={values?.end_time ?? "18:00"}
            readOnly={pending}
          />
        </fieldset>
      </div>
      <label htmlFor="block-reason">Motivo (opcional)</label>
      <input
        id="block-reason"
        name="reason"
        maxLength={160}
        defaultValue={values?.reason ?? ""}
        placeholder="Ex.: feriado ou férias"
        aria-describedby="schedule-block-privacy"
        readOnly={pending}
      />
      <p id="schedule-block-privacy">
        Até 160 caracteres. O motivo fica visível aos gestores e aos
        colaboradores autorizados a consultar esse bloqueio.
      </p>
      <button type="submit" disabled={pending} aria-disabled={pending}>
        {pending && <span className="ui-spinner" aria-hidden="true" />}
        {pending ? "Salvando bloqueio…" : "Criar bloqueio"}
      </button>
      <p role="status" aria-live="polite">
        {pending
          ? "Verificando o intervalo e os agendamentos existentes…"
          : "Horários de São Paulo. Se houver agendamento no intervalo, o bloqueio será recusado."}
      </p>
    </form>
  );
}
