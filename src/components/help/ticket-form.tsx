"use client";

import { useActionState } from "react";
import { helpModules, type HelpFormState } from "@/lib/help";
import { Icon } from "@/components/ui/icon";

export function TicketForm({
  action,
  requestKey,
  companyId,
  module,
}: {
  action: (previous: HelpFormState, form: FormData) => Promise<HelpFormState>;
  requestKey: string;
  companyId: string;
  module: string;
}) {
  const [state, submit, pending] = useActionState(
    action,
    {},
    `/painel/${companyId}/ajuda`,
  );
  return (
    <form action={submit} className="help-form" aria-busy={pending}>
      <input
        type="hidden"
        name="request_key"
        value={state.values?.request_key ?? requestKey}
      />
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <label htmlFor="ticket-module">Sobre qual assunto?</label>
      <select
        id="ticket-module"
        name="module"
        defaultValue={state.values?.module ?? module}
        disabled={pending}
        required
      >
        {helpModules.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <label htmlFor="ticket-subject">Resumo da solicitação</label>
      <input
        id="ticket-subject"
        name="subject"
        minLength={5}
        maxLength={140}
        required
        placeholder="Ex.: dúvida ao configurar os horários"
        defaultValue={state.values?.subject ?? ""}
        readOnly={pending}
        aria-invalid={Boolean(state.fields?.subject)}
        aria-describedby={
          state.fields?.subject ? "ticket-subject-error" : undefined
        }
      />
      {state.fields?.subject && (
        <p id="ticket-subject-error" className="help-field-error">
          {state.fields.subject}
        </p>
      )}
      <label htmlFor="ticket-message">Como podemos ajudar?</label>
      <textarea
        id="ticket-message"
        name="message"
        rows={5}
        minLength={20}
        maxLength={4000}
        required
        placeholder="Conte o que você tentou fazer e o que aconteceu."
        defaultValue={state.values?.message ?? ""}
        readOnly={pending}
        aria-invalid={Boolean(state.fields?.message)}
        aria-describedby={`ticket-privacy${state.fields?.message ? " ticket-message-error" : ""}`}
      />
      {state.fields?.message && (
        <p id="ticket-message-error" className="help-field-error">
          {state.fields.message}
        </p>
      )}
      <p id="ticket-privacy" className="help-hint">
        Não inclua senhas, chaves privadas ou dados sensíveis de clientes. A
        solicitação fica visível para o suporte e os gestores desta empresa.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? (
          <>
            <span className="ui-spinner" aria-hidden="true" /> Enviando…
          </>
        ) : (
          <>
            Enviar solicitação <Icon name="arrow-right" size={16} />
          </>
        )}
      </button>
      <p className="help-hint" role="status" aria-live="polite">
        {pending
          ? "Registrando sua solicitação com segurança."
          : "Você acompanha o andamento e a resposta nesta página."}
      </p>
    </form>
  );
}
