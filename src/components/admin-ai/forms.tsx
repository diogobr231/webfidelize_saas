"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PendingButton } from "@/components/pending-button";
import {
  requestAnalysis,
  saveAiSettings,
  processAiQueue,
  reviewAnalysis,
  retryAnalysis,
  type AiActionState,
} from "@/app/admin/ia/actions";
import {
  aiSourceTypes,
  aiSourceLabels,
  type AiSettings,
  type AiJob,
  type AiSourceOption,
  type AiSourceType,
} from "@/lib/admin-ai/types";

function Feedback({ state }: { state: AiActionState }) {
  return state.error ? (
    <p className="notice error" role="alert">
      {state.error}
    </p>
  ) : null;
}

export function AiRequestForm({
  sources,
  selectedType,
  selectedId,
}: {
  sources: AiSourceOption[];
  selectedType: AiSourceType;
  selectedId: string;
}) {
  const [state, submit] = useActionState(requestAnalysis, {});
  const [type, setType] = useState(selectedType);
  const [id, setId] = useState(
    selectedId ||
      sources.find((source) => source.type === selectedType)?.id ||
      "",
  );
  const choices = sources.filter((source) => source.type === type);
  return (
    <form action={submit} data-ai-form="request" className="ai-form">
      <label htmlFor="ai-source-type">
        O que vamos analisar?
        <select
          id="ai-source-type"
          name="source_type"
          value={type}
          onChange={(event) => {
            const next = event.target.value as AiSourceType;
            setType(next);
            setId(sources.find((source) => source.type === next)?.id ?? "");
          }}
        >
          {aiSourceTypes.map((value) => (
            <option value={value} key={value}>
              {aiSourceLabels[value]}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="ai-source-id">
        Registro de origem
        <select
          id="ai-source-id"
          name="source_id"
          value={id}
          onChange={(event) => setId(event.target.value)}
          required
        >
          <option value="">Selecione um registro</option>
          {choices.map((source) => (
            <option value={source.id} key={source.id}>
              {source.label}
            </option>
          ))}
        </select>
      </label>
      {!choices.length && (
        <p className="ai-hint">
          Nenhum registro disponível deste tipo. Cadastre um contato, abra uma
          solicitação ou consulte as tarefas da operação.
        </p>
      )}
      <PendingButton pendingLabel="Preparando…">
        Adicionar à fila de análise
      </PendingButton>
      <Feedback state={state} />
    </form>
  );
}
export function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const [state, submit] = useActionState(saveAiSettings, {});
  const [enabled, setEnabled] = useState(String(settings.enabled));
  const [automatic, setAutomatic] = useState(String(settings.auto_enqueue));
  const [daily, setDaily] = useState(String(settings.daily_limit));
  const [monthly, setMonthly] = useState(String(settings.monthly_limit));
  return (
    <form action={submit} data-ai-form="settings" className="ai-form">
      <input name="updated_at" value={settings.updated_at} type="hidden" />
      <div className="ai-form-pair">
        <label htmlFor="ai-enabled">
          Processamento
          <select
            id="ai-enabled"
            name="enabled"
            value={enabled}
            onChange={(event) => setEnabled(event.target.value)}
          >
            <option value="true">Habilitado</option>
            <option value="false">Pausado</option>
          </select>
        </label>
        <label htmlFor="ai-auto">
          Entrada automática na fila
          <select
            id="ai-auto"
            name="auto_enqueue"
            value={automatic}
            onChange={(event) => setAutomatic(event.target.value)}
          >
            <option value="true">Habilitada</option>
            <option value="false">Somente solicitações manuais</option>
          </select>
        </label>
      </div>
      <div className="ai-form-pair">
        <label htmlFor="ai-daily">
          Limite de tentativas por dia
          <input
            id="ai-daily"
            name="daily_limit"
            value={daily}
            onChange={(event) => setDaily(event.target.value)}
            type="number"
            min="1"
            max="50"
            step="1"
            inputMode="numeric"
            required
          />
        </label>
        <label htmlFor="ai-monthly">
          Limite de tentativas por mês
          <input
            id="ai-monthly"
            name="monthly_limit"
            value={monthly}
            onChange={(event) => setMonthly(event.target.value)}
            type="number"
            min="1"
            max="500"
            step="1"
            inputMode="numeric"
            required
          />
        </label>
      </div>
      <p className="ai-hint">
        Ao habilitar, você autoriza o processamento dos registros selecionados
        pelo provedor de IA. São enviados contexto comercial ou descrição da
        solicitação e o catálogo. Nome, telefone e e-mail não são incluídos como
        campos; textos livres podem conter informações pessoais. Revise o
        conteúdo antes de solicitar.
      </p>
      <PendingButton>Salvar configuração</PendingButton>
      <Feedback state={state} />
    </form>
  );
}
export function AiProcessForm() {
  const [state, submit] = useActionState(processAiQueue, {});
  return (
    <form action={submit} data-ai-form="process" className="ai-process-form">
      <PendingButton pendingLabel="Processando análises…">
        Processar até 3 análises
      </PendingButton>
      <Feedback state={state} />
    </form>
  );
}
function ReviewButton({
  value,
  children,
}: {
  value: "save" | "approve" | "discard";
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="action"
      value={value}
      className={value === "approve" ? undefined : "secondary"}
      disabled={pending}
      aria-busy={pending}
      formNoValidate={value === "discard"}
    >
      {pending ? "Salvando…" : children}
    </button>
  );
}
export function AiReviewForm({ job }: { job: AiJob }) {
  const [state, submit] = useActionState(reviewAnalysis, {});
  const [body, setBody] = useState(
    job.reviewed_body ||
      job.output?.suggested_reply ||
      job.output?.next_action ||
      "",
  );
  return (
    <form action={submit} data-ai-form="review" className="ai-form">
      <input name="id" type="hidden" value={job.id} />
      <input name="updated_at" type="hidden" value={job.updated_at} />
      <label htmlFor="ai-review-body">
        Seu rascunho para revisão
        <textarea
          id="ai-review-body"
          name="body"
          rows={7}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          minLength={3}
          maxLength={2000}
          required
          aria-describedby="ai-review-note"
        />
      </label>
      <p id="ai-review-note" className="ai-hint">
        A aprovação é interna. Em oportunidades e tarefas comerciais, o texto
        vira uma nota no funil. Para suporte e demais tarefas, fica salvo nesta
        central. Nenhuma resposta é publicada para o cliente.
      </p>
      <div className="ai-form-actions">
        <ReviewButton value="save">Salvar rascunho</ReviewButton>
        <ReviewButton value="approve">Aprovar internamente</ReviewButton>
        <ReviewButton value="discard">Descartar rascunho</ReviewButton>
      </div>
      <Feedback state={state} />
    </form>
  );
}
export function AiRetryForm({
  job,
}: {
  job: Pick<AiJob, "id" | "updated_at">;
}) {
  const [state, submit] = useActionState(retryAnalysis, {});
  return (
    <form
      action={submit}
      data-ai-form="retry"
      className="ai-form ai-retry-form"
    >
      <input name="id" type="hidden" value={job.id} />
      <input name="updated_at" type="hidden" value={job.updated_at} />
      <label className="ai-confirm">
        <input type="checkbox" name="confirm_retry" value="yes" required />
        <span>
          Quero criar uma nova tentativa. Ela poderá consumir uma nova geração
          no provedor.
        </span>
      </label>
      <PendingButton className="secondary">
        Preparar nova tentativa
      </PendingButton>
      <Feedback state={state} />
    </form>
  );
}
