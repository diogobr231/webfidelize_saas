"use client";

import { useActionState } from "react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { PendingButton } from "@/components/pending-button";
import {
  businessPriceInput,
  type BusinessRecord,
  type BusinessRecordState,
  type BusinessSection,
} from "@/lib/business-records";

type Action = (
  state: BusinessRecordState,
  form: FormData,
) => Promise<BusinessRecordState>;
const initialState: BusinessRecordState = {};
function FormNotice({
  state,
  permalink,
}: {
  state: BusinessRecordState;
  permalink: string;
}) {
  return state.error ? (
    <div className="notice error" role="alert">
      <p>{state.error}</p>
      <a href={permalink}>Abrir versão atual da ficha</a>
    </div>
  ) : null;
}
function FieldError({
  name,
  state,
}: {
  name: string;
  state: BusinessRecordState;
}) {
  return state.fields?.[name] ? (
    <p className="business-field-error" id={`record-${name}-error`}>
      {state.fields[name]}
    </p>
  ) : null;
}
export function RecordEditForm({
  record,
  section,
  saveAction,
  permalink,
}: {
  record: BusinessRecord;
  section: BusinessSection;
  saveAction: Action;
  permalink: string;
}) {
  const [state, action] = useActionState(saveAction, initialState, permalink);
  const fieldProps = (name: string) => ({
    "aria-invalid": Boolean(state.fields?.[name]),
    "aria-describedby": state.fields?.[name]
      ? `record-${name}-error`
      : undefined,
  });
  return (
    <form
      action={action}
      className="business-edit-form"
      key={state.feedbackKey}
    >
      <FormNotice state={state} permalink={permalink} />
      <input
        type="hidden"
        name="version"
        value={state.values?.version ?? record.record_version}
      />
      <div>
        <label htmlFor="record-name">Nome</label>
        <input
          id="record-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={state.values?.name ?? record.name}
          {...fieldProps("name")}
        />
        <FieldError name="name" state={state} />
      </div>
      {section === "customers" ? (
        <div>
          <label htmlFor="record-phone">Telefone</label>
          <input
            id="record-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            defaultValue={state.values?.phone ?? record.phone ?? ""}
            {...fieldProps("phone")}
          />
          <FieldError name="phone" state={state} />
        </div>
      ) : null}
      {section === "services" ? (
        <>
          <div className="form-grid">
            <div>
              <label htmlFor="record-duration">Duração em minutos</label>
              <input
                id="record-duration"
                name="duration"
                type="number"
                inputMode="numeric"
                min={5}
                max={480}
                step={1}
                required
                defaultValue={state.values?.duration ?? record.duration_minutes}
                {...fieldProps("duration")}
              />
              <FieldError name="duration" state={state} />
            </div>
            <div>
              <label htmlFor="record-price">Preço atual em reais</label>
              <input
                id="record-price"
                name="price"
                type="text"
                inputMode="decimal"
                maxLength={9}
                required
                placeholder="50,00"
                defaultValue={
                  state.values?.price ??
                  businessPriceInput(record.price_cents ?? 0)
                }
                {...fieldProps("price")}
              />
              <FieldError name="price" state={state} />
            </div>
          </div>
          <p className="business-note">
            A nova duração vale para novos agendamentos. Remarcações mantêm a
            duração originalmente reservada. O preço atual não
            representa pagamentos recebidos.
          </p>
        </>
      ) : null}
      <PendingButton>Salvar alterações</PendingButton>
    </form>
  );
}
export function RecordArchiveForm({
  record,
  section,
  saveAction,
  permalink,
}: {
  record: BusinessRecord;
  section: BusinessSection;
  saveAction: Action;
  permalink: string;
}) {
  const [state, action] = useActionState(saveAction, initialState, permalink);
  const archived = Boolean(record.archived_at);
  const description = archived
    ? "O cadastro voltará a aparecer nas opções para novos agendamentos. O histórico será preservado."
    : `O cadastro deixará de aparecer nas opções para novos agendamentos. O histórico será preservado e você poderá reativá-lo depois.${section === "professionals" ? " Isso não revoga o acesso da conta vinculada." : ""}`;
  return (
    <form
      action={action}
      className="business-archive-form"
      key={state.feedbackKey}
    >
      <FormNotice state={state} permalink={permalink} />
      <input type="hidden" name="version" value={record.record_version} />
      <input type="hidden" name="archived" value={String(!archived)} />
      <ConfirmSubmit
        label={archived ? "Reativar cadastro" : "Arquivar cadastro"}
        description={description}
      />
    </form>
  );
}
