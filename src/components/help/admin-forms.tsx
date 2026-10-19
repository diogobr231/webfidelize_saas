"use client";

import { useActionState } from "react";
import {
  helpModules,
  ticketStatuses,
  type HelpArticle,
  type HelpFormState,
  type SupportTicket,
} from "@/lib/help";
type Action = (
  previous: HelpFormState,
  form: FormData,
) => Promise<HelpFormState>;

export function ArticleEditor({
  action,
  article,
}: {
  action: Action;
  article: HelpArticle | null;
}) {
  const [state, submit, pending] = useActionState(
    action,
    {},
    article ? `/admin/ajuda?editar=${article.id}` : "/admin/ajuda",
  );
  const value = (key: keyof HelpArticle) =>
    state.values?.[key] ?? String(article?.[key] ?? "");
  return (
    <form className="help-form" action={submit} aria-busy={pending}>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <label htmlFor="article-title">Título</label>
      <input
        id="article-title"
        name="title"
        required
        minLength={5}
        maxLength={140}
        defaultValue={value("title")}
        readOnly={pending}
        aria-invalid={Boolean(state.fields?.title)}
      />
      <div className="help-form-pair">
        <div>
          <label htmlFor="article-module">Assunto</label>
          <select
            id="article-module"
            name="module"
            defaultValue={value("module") || "primeiros-passos"}
            disabled={pending}
          >
            {helpModules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="article-kind">Tipo</label>
          <select
            id="article-kind"
            name="kind"
            defaultValue={value("kind") || "faq"}
            disabled={pending}
          >
            <option value="faq">Pergunta frequente</option>
            <option value="tutorial">Passo a passo</option>
          </select>
        </div>
      </div>
      <label htmlFor="article-body">Conteúdo</label>
      <textarea
        id="article-body"
        name="body"
        rows={11}
        minLength={20}
        maxLength={12000}
        required
        defaultValue={value("body")}
        readOnly={pending}
        aria-invalid={Boolean(state.fields?.body)}
        aria-describedby="article-body-hint"
      />
      <p id="article-body-hint" className="help-hint">
        Texto simples. Separe os passos por linhas. HTML e scripts não são
        executados. Descreva somente recursos disponíveis.
      </p>
      <label htmlFor="article-order">Ordem de exibição</label>
      <input
        id="article-order"
        name="sort_order"
        type="number"
        min={0}
        max={1000}
        required
        defaultValue={value("sort_order") || "0"}
        readOnly={pending}
      />
      <label className="help-checkbox">
        <input
          type="checkbox"
          name="published"
          defaultChecked={
            state.values?.published !== undefined
              ? state.values.published === "true"
              : (article?.published ?? false)
          }
          disabled={pending}
        />
        <span>Publicado para os clientes</span>
      </label>
      <p className="help-hint">
        Desmarque para guardar como rascunho e retirar da Central de ajuda,
        mantendo o conteúdo salvo.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Salvando conteúdo…" : "Salvar conteúdo"}
      </button>
    </form>
  );
}
export function TicketResponse({
  action,
  ticket,
}: {
  action: Action;
  ticket: SupportTicket;
}) {
  const [state, submit, pending] = useActionState(
    action,
    {},
    `/admin/ajuda?solicitacao=${ticket.id}`,
  );
  return (
    <form
      className="help-form help-response-form"
      action={submit}
      aria-busy={pending}
    >
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <label htmlFor={`response-status-${ticket.id}`}>Andamento</label>
      <select
        id={`response-status-${ticket.id}`}
        name="status"
        defaultValue={state.values?.status ?? ticket.status}
        disabled={pending}
      >
        {Object.entries(ticketStatuses).map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
      <label htmlFor={`response-body-${ticket.id}`}>
        Resposta para a empresa
      </label>
      <textarea
        id={`response-body-${ticket.id}`}
        name="response"
        rows={5}
        maxLength={4000}
        defaultValue={state.values?.response ?? ticket.response}
        readOnly={pending}
        aria-describedby={`response-note-${ticket.id}`}
      />
      <p id={`response-note-${ticket.id}`} className="help-hint">
        Esta resposta aparece para o solicitante e os gestores da empresa.
        Atualizar substitui a resposta exibida; nenhuma mensagem externa é
        enviada.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Salvando resposta…" : "Salvar atendimento"}
      </button>
    </form>
  );
}
