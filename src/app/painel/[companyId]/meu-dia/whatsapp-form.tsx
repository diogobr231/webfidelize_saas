"use client";

import { useActionState, useState } from "react";
import { PendingButton } from "@/components/pending-button";
import type { WhatsAppFormState } from "@/lib/whatsapp-forms";

type Action = (
  previous: WhatsAppFormState,
  form: FormData,
) => Promise<WhatsAppFormState>;
const empty: WhatsAppFormState = {};

export function MyWhatsAppPreferenceForm({
  phone,
  enabled,
  writable,
  action,
  permalink,
}: {
  phone: string | null;
  enabled: boolean;
  writable: boolean;
  action: Action;
  permalink: string;
}) {
  const [state, submit] = useActionState(action, empty, permalink);
  const [choice, setChoice] = useState(enabled ? "yes" : "no");
  return (
    <form action={submit} className="reminder-settings">
      {writable ? (
        <fieldset>
          <legend className="sr-only">
            Sua autorização para avisos da agenda
          </legend>
          <label>
            Minha preferência
            <select
              name="enabled"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="no">Não receber avisos no WhatsApp</option>
              <option value="yes">
                Receber minha agenda e novos agendamentos
              </option>
            </select>
          </label>
          {choice === "yes" ? (
            <>
              <label>
                Meu WhatsApp com DDD
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={30}
                  defaultValue={phone || ""}
                  placeholder="(11) 99999-9999"
                  required
                  aria-describedby="staff-phone-help"
                />
              </label>
              <p className="reminder-help" id="staff-phone-help">
                Use seu próprio número. Sua preferência é exclusiva desta
                empresa.
              </p>
              <label className="reminder-toggle">
                <input type="checkbox" name="attestation" required />
                <span>
                  Este WhatsApp é meu e autorizo receber minha agenda e avisos
                  de novos agendamentos desta empresa. Posso revogar a qualquer
                  momento.
                </span>
              </label>
            </>
          ) : null}
          <PendingButton>Salvar minha preferência</PendingButton>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="enabled" value="no" />
          <p className="reminder-help">
            Para autorizar os avisos, sua conta precisa estar vinculada a um
            profissional ativo e a empresa precisa ter acesso válido.
            {enabled
              ? " Você ainda pode revogar sua autorização."
              : " Você não está autorizado para novos avisos."}
          </p>
          {enabled ? (
            <PendingButton>Revogar minha autorização</PendingButton>
          ) : null}
        </>
      )}
      <div aria-live="polite" aria-atomic="true">
        {state.error ? (
          <p className="notice error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p className="notice" role="status">
            {state.success}
          </p>
        ) : null}
      </div>
    </form>
  );
}
