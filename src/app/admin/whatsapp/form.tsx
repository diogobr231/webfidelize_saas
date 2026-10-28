"use client";
import { useActionState } from "react";
import { PendingButton } from "@/components/pending-button";
import type { WhatsAppFormState } from "@/lib/whatsapp-forms";
export function CompanyLimitForm({
  limit,
  action,
}: {
  limit: number;
  action: (
    state: WhatsAppFormState,
    form: FormData,
  ) => Promise<WhatsAppFormState>;
}) {
  const [state, submit] = useActionState(action, {}, "/admin/whatsapp");
  return (
    <form action={submit} className="reminder-settings">
      <fieldset>
        <legend className="sr-only">Limite de consumo da empresa</legend>
        <label>
          Cota mensal liberada
          <input
            name="platform_limit"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            step={1}
            required
            defaultValue={limit}
          />
        </label>
        <PendingButton>Salvar cota</PendingButton>
      </fieldset>
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
