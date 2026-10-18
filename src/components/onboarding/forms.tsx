"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { startCompany } from "@/app/comecar/actions";
import {
  initialSetupState,
  serviceHint,
  type SetupActionState,
} from "@/lib/onboarding";
import { niches } from "@/lib/catalog";

type SetupAction = (
  previous: SetupActionState,
  form: FormData,
) => Promise<SetupActionState>;

function ErrorMessage({ state }: { state: SetupActionState }) {
  if (!state.error) return null;
  return (
    <div className="onb-error" role="alert">
      <strong>Vamos conferir uma informação?</strong>
      <p>{state.error}</p>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="onb-field-error" id={id} role="alert">
      {message}
    </p>
  ) : null;
}

function FormActions({ nextLabel }: { nextLabel: string }) {
  const { pending, data } = useFormStatus();
  const pausing = pending && data?.get("intent") === "pause";
  return (
    <div className="onb-form-footer">
      <div className="onb-actions">
        <button
          className="onb-primary"
          type="submit"
          name="intent"
          value="next"
          disabled={pending}
        >
          {pending && !pausing ? "Salvando sua configuração…" : nextLabel}
          <span aria-hidden="true">→</span>
        </button>
        <button
          className="onb-secondary"
          type="submit"
          name="intent"
          value="pause"
          disabled={pending}
        >
          {pausing
            ? "Salvando para continuar depois…"
            : "Salvar e continuar depois"}
        </button>
      </div>
      <p className="onb-note" role="status" aria-live="polite">
        {pending
          ? "Aguarde enquanto salvamos os dados desta etapa."
          : "Os dados são salvos quando você confirma esta etapa."}
      </p>
    </div>
  );
}

export function CompanySetupForm() {
  const [state, action, pending] = useActionState(
    startCompany,
    initialSetupState,
    "/comecar",
  );
  const [name, setName] = useState(state.values?.name ?? "");
  const [niche, setNiche] = useState(state.values?.niche ?? "");
  return (
    <form
      action={action}
      className="onb-card onb-form"
      noValidate
      aria-busy={pending}
    >
      <ErrorMessage state={state} />
      <div className="onb-field">
        <label htmlFor="setup-company-name">
          Nome da sua empresa <span aria-hidden="true">*</span>
        </label>
        <input
          id="setup-company-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={100}
          autoComplete="organization"
          placeholder="Como seus clientes conhecem você?"
          required
          readOnly={pending}
          aria-invalid={Boolean(state.fields?.name)}
          aria-describedby={`setup-company-name-hint${state.fields?.name ? " setup-company-name-error" : ""}`}
        />
        <p className="onb-field-hint" id="setup-company-name-hint">
          Este nome identifica sua empresa no painel e na página de agendamento.
        </p>
        <FieldError
          id="setup-company-name-error"
          message={state.fields?.name}
        />
      </div>
      <fieldset
        className="onb-niches"
        aria-describedby={`setup-niche-hint${state.fields?.niche ? " setup-niche-error" : ""}`}
        disabled={pending}
      >
        <legend>
          Qual é o seu segmento? <span aria-hidden="true">*</span>
        </legend>
        <p className="onb-field-hint" id="setup-niche-hint">
          Escolha a opção que melhor descreve sua empresa. Os segmentos
          compartilham a agenda, os clientes e os serviços.
        </p>
        <div className="onb-niche-grid">
          {niches.map((item, index) => (
            <label className="onb-niche-card" key={item.slug}>
              <input
                type="radio"
                name="niche"
                value={item.slug}
                checked={niche === item.slug}
                onChange={() => setNiche(item.slug)}
                required
                aria-invalid={Boolean(state.fields?.niche)}
              />
              <span className="onb-niche-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="onb-niche-copy">
                <strong>{item.name}</strong>
                <small>
                  {index < 4
                    ? "Agenda, clientes e serviços"
                    : "Agenda geral; módulo específico em planejamento"}
                </small>
              </span>
              <span className="onb-radio-indicator" aria-hidden="true" />
            </label>
          ))}
        </div>
        <FieldError id="setup-niche-error" message={state.fields?.niche} />
      </fieldset>
      <div className="onb-tip">
        <span aria-hidden="true">✦</span>
        <p>
          Seu teste de 7 dias começa ao criar a empresa, no plano Essencial com
          1 profissional na agenda. Sem cartão e sem cobrança automática.
        </p>
      </div>
      <FormActions nextLabel="Criar empresa e continuar" />
    </form>
  );
}

export function ServiceSetupForm({
  companyId,
  niche,
  recordId,
  saveAction,
  additional = false,
}: {
  companyId: string;
  niche: string;
  recordId: string;
  saveAction: SetupAction;
  additional?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveAction,
    initialSetupState,
    `/painel/${companyId}/configuracao?etapa=servicos`,
  );
  const [name, setName] = useState(state.values?.name ?? "");
  const [duration, setDuration] = useState(state.values?.duration ?? "");
  const [price, setPrice] = useState(state.values?.price ?? "");
  const form = (
    <form action={action} className="onb-form" noValidate aria-busy={pending}>
      <input name="record_id" type="hidden" value={recordId} />
      <ErrorMessage state={state} />
      <div className="onb-field">
        <label htmlFor="setup-service-name">
          Nome do serviço <span aria-hidden="true">*</span>
        </label>
        <input
          id="setup-service-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          required
          readOnly={pending}
          autoComplete="off"
          placeholder="Informe o atendimento que você oferece"
          aria-invalid={Boolean(state.fields?.name)}
          aria-describedby={`setup-service-name-hint${state.fields?.name ? " setup-service-name-error" : ""}`}
        />
        <p className="onb-field-hint" id="setup-service-name-hint">
          {serviceHint(niche)}
        </p>
        <FieldError
          id="setup-service-name-error"
          message={state.fields?.name}
        />
      </div>
      <div className="onb-fields-row">
        <div className="onb-field">
          <label htmlFor="setup-service-duration">
            Duração em minutos <span aria-hidden="true">*</span>
          </label>
          <input
            id="setup-service-duration"
            name="duration"
            type="number"
            inputMode="numeric"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            min={5}
            max={480}
            step={1}
            required
            readOnly={pending}
            placeholder="Ex.: 30"
            aria-invalid={Boolean(state.fields?.duration)}
            aria-describedby={`setup-service-duration-hint${state.fields?.duration ? " setup-service-duration-error" : ""}`}
          />
          <p className="onb-field-hint" id="setup-service-duration-hint">
            De 5 a 480 minutos. A agenda reserva esse intervalo para o
            atendimento.
          </p>
          <FieldError
            id="setup-service-duration-error"
            message={state.fields?.duration}
          />
        </div>
        <div className="onb-field">
          <label htmlFor="setup-service-price">
            Preço em reais <span aria-hidden="true">*</span>
          </label>
          <input
            id="setup-service-price"
            name="price"
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            maxLength={12}
            required
            readOnly={pending}
            placeholder="Ex.: 50,00"
            aria-invalid={Boolean(state.fields?.price)}
            aria-describedby={`setup-service-price-hint${state.fields?.price ? " setup-service-price-error" : ""}`}
          />
          <p className="onb-field-hint" id="setup-service-price-hint">
            Use vírgula ou ponto nos centavos. Informe 0 se o serviço não tiver
            cobrança.
          </p>
          <FieldError
            id="setup-service-price-error"
            message={state.fields?.price}
          />
        </div>
      </div>
      <div className="onb-tip">
        <span aria-hidden="true">◷</span>
        <p>
          Comece com um serviço real do seu negócio. Você poderá adicionar
          outros na área de serviços do painel.
        </p>
      </div>
      <FieldError
        id="setup-service-record-error"
        message={state.fields?.record_id}
      />
      <FormActions nextLabel="Salvar serviço e continuar" />
    </form>
  );
  return additional ? (
    <details className="onb-card" open={state.error ? true : undefined}>
      <summary>Adicionar outro serviço</summary>
      {form}
    </details>
  ) : (
    <section className="onb-card">{form}</section>
  );
}

export function ProfessionalSetupForm({
  companyId,
  recordId,
  saveAction,
  additional = false,
}: {
  companyId: string;
  recordId: string;
  saveAction: SetupAction;
  additional?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveAction,
    initialSetupState,
    `/painel/${companyId}/configuracao?etapa=equipe`,
  );
  const [name, setName] = useState(state.values?.name ?? "");
  const form = (
    <form action={action} className="onb-form" noValidate aria-busy={pending}>
      <input name="record_id" type="hidden" value={recordId} />
      <ErrorMessage state={state} />
      <div className="onb-field">
        <label htmlFor="setup-professional-name">
          Nome do profissional <span aria-hidden="true">*</span>
        </label>
        <input
          id="setup-professional-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={120}
          required
          readOnly={pending}
          autoComplete="name"
          placeholder="Nome de quem vai realizar os atendimentos"
          aria-invalid={Boolean(state.fields?.name)}
          aria-describedby={`setup-professional-name-hint${state.fields?.name ? " setup-professional-name-error" : ""}`}
        />
        <p className="onb-field-hint" id="setup-professional-name-hint">
          Se você realiza os atendimentos, cadastre seu próprio nome. O
          proprietário também ocupa uma vaga quando atua como profissional.
        </p>
        <FieldError
          id="setup-professional-name-error"
          message={state.fields?.name}
        />
      </div>
      <div className="onb-tip">
        <span aria-hidden="true">♙</span>
        <p>
          <strong>
            Profissional na agenda é diferente de acesso ao sistema.
          </strong>{" "}
          Este cadastro identifica quem atende. Os convites para acessar o
          painel são gerenciados separadamente na área de equipe.
        </p>
      </div>
      <FieldError
        id="setup-professional-record-error"
        message={state.fields?.record_id}
      />
      <FormActions nextLabel="Salvar profissional e continuar" />
    </form>
  );
  return additional ? (
    <details className="onb-card" open={state.error ? true : undefined}>
      <summary>Adicionar outro profissional</summary>
      {form}
    </details>
  ) : (
    <section className="onb-card">{form}</section>
  );
}
