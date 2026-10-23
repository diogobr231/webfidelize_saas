"use client";

import { useActionState, useId } from "react";
import { PendingButton } from "@/components/pending-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import type { ClassChoice, ClassFormState } from "@/lib/classes";
import type { ClassAction } from "./class-form";

const initial: ClassFormState = {};
export function ParticipantForm({
  action,
  customers,
  requestId,
}: {
  action: ClassAction;
  customers: ClassChoice[];
  requestId: string;
}) {
  const [state, submit] = useActionState(action, initial);
  const id = useId();
  return (
    <form
      action={submit}
      className="class-form"
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="request_id" value={requestId} />
      <label htmlFor={`${id}-customer`}>
        Cliente cadastrado
        <select id={`${id}-customer`} name="customer" required defaultValue="">
          <option value="">Selecione o participante</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>
      {state.error && (
        <p role="alert" className="notice error">
          {state.error}
        </p>
      )}
      <PendingButton>Adicionar participante</PendingButton>
    </form>
  );
}

export function ClassMutationForm({
  action,
  version,
  operation,
  label,
  confirmation,
}: {
  action: ClassAction;
  version: number;
  operation: string;
  label: string;
  confirmation?: string;
}) {
  const [state, submit] = useActionState(action, initial);
  return (
    <form action={submit} className="class-mutation">
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="operation" value={operation} />
      {confirmation ? (
        <ConfirmSubmit label={label} description={confirmation} />
      ) : (
        <PendingButton pendingLabel="Registrando…">{label}</PendingButton>
      )}
      {state.error && (
        <p role="alert" className="notice error">
          {state.error}
        </p>
      )}
    </form>
  );
}
