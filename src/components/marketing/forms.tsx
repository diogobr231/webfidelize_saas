"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import {
  buildMarketingDraft,
  buildMarketingReply,
  marketingChannels,
  marketingChannelLabels,
  marketingGoals,
  marketingGoalLabels,
  type MarketingCampaign,
} from "@/lib/marketing";
import { niches } from "@/lib/catalog";

export type MarketingActionState = { error?: string; success?: string };
type MarketingAction = (
  state: MarketingActionState,
  form: FormData,
) => Promise<MarketingActionState>;

function Feedback({ state }: { state: MarketingActionState }) {
  return (
    <>
      {state.error ? (
        <p className="mk-feedback mk-feedback-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="mk-feedback" role="status">
          {state.success}
        </p>
      ) : null}
    </>
  );
}

function Submit({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <button
      className="button mk-submit"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <span className="ui-spinner" aria-hidden="true" />
      ) : (
        <Icon name="check" size={16} />
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}

export function MarketingActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Salvando…",
}: {
  action: MarketingAction;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="mk-action-form">
      <fieldset disabled={pending} className="mk-action-fields">
        {children}
      </fieldset>
      <Submit
        pending={pending}
        label={submitLabel}
        pendingLabel={pendingLabel}
      />
      <Feedback state={state} />
    </form>
  );
}

type CampaignFields = Pick<
  MarketingCampaign,
  | "name"
  | "channel"
  | "goal"
  | "niche"
  | "audience"
  | "brief"
  | "headline"
  | "body"
  | "cta"
> & { budget: string };

export function CampaignForm({
  campaign,
  requestId,
  action,
}: {
  campaign?: MarketingCampaign;
  requestId: string;
  action: MarketingAction;
}) {
  const formId = useId();
  const [state, submit, pending] = useActionState(action, {});
  const [modelNotice, setModelNotice] = useState("");
  const [values, setValues] = useState<CampaignFields>(() => ({
    name: campaign?.name ?? "",
    channel: campaign?.channel ?? "instagram",
    goal: campaign?.goal ?? "demo",
    niche: campaign?.niche ?? "all",
    audience: campaign?.audience ?? "",
    brief: campaign?.brief ?? "",
    budget: ((campaign?.budget_cents ?? 0) / 100).toFixed(2).replace(".", ","),
    headline: campaign?.headline ?? "",
    body: campaign?.body ?? "",
    cta: campaign?.cta ?? "",
  }));
  function update<K extends keyof CampaignFields>(
    key: K,
    value: CampaignFields[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  function useModel() {
    setValues((current) => ({ ...current, ...buildMarketingDraft(current) }));
    setModelNotice(
      "Modelo editável aplicado aos campos. Revise o texto antes de salvar ou publicar em uma plataforma.",
    );
  }
  return (
    <form
      action={submit}
      className="mk-form"
      aria-label={campaign ? "Editar campanha" : "Criar campanha"}
    >
      {campaign ? (
        <input type="hidden" name="campaign_id" value={campaign.id} />
      ) : null}
      <input type="hidden" name="version" value={campaign?.version ?? 1} />
      <input type="hidden" name="request_id" value={requestId} />
      <fieldset disabled={pending} className="mk-form-fields">
        <legend className="sr-only">Planejamento e texto da campanha</legend>
        <label htmlFor={`${formId}-name`}>
          Nome da campanha
          <input
            id={`${formId}-name`}
            name="name"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            required
            minLength={3}
            maxLength={100}
            placeholder="Ex.: Agenda organizada para salões"
          />
        </label>
        <div className="mk-field-grid">
          <label htmlFor={`${formId}-channel`}>
            Canal
            <select
              id={`${formId}-channel`}
              name="channel"
              value={values.channel}
              onChange={(e) =>
                update("channel", e.target.value as CampaignFields["channel"])
              }
            >
              {marketingChannels.map((value) => (
                <option key={value} value={value}>
                  {marketingChannelLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${formId}-goal`}>
            Objetivo
            <select
              id={`${formId}-goal`}
              name="goal"
              value={values.goal}
              onChange={(e) =>
                update("goal", e.target.value as CampaignFields["goal"])
              }
            >
              {marketingGoals.map((value) => (
                <option key={value} value={value}>
                  {marketingGoalLabels[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mk-field-grid">
          <label htmlFor={`${formId}-niche`}>
            Segmento do público
            <select
              id={`${formId}-niche`}
              name="niche"
              value={values.niche}
              onChange={(e) =>
                update("niche", e.target.value as CampaignFields["niche"])
              }
            >
              <option value="all">Todos os segmentos</option>
              {niches.map((niche) => (
                <option key={niche.slug} value={niche.slug}>
                  {niche.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${formId}-budget`}>
            Orçamento planejado em reais
            <input
              id={`${formId}-budget`}
              name="budget"
              value={values.budget}
              onChange={(e) => update("budget", e.target.value)}
              inputMode="decimal"
              maxLength={12}
              placeholder="0,00"
              required
              aria-describedby={`${formId}-budget-help`}
            />
          </label>
        </div>
        <p className="mk-hint" id={`${formId}-budget-help`}>
          Este valor é apenas planejamento. Salvar a campanha não compra
          anúncios nem cria cobranças.
        </p>
        <label htmlFor={`${formId}-audience`}>
          Quem você quer alcançar?
          <textarea
            id={`${formId}-audience`}
            name="audience"
            value={values.audience}
            onChange={(e) => update("audience", e.target.value)}
            rows={2}
            required
            minLength={3}
            maxLength={500}
            placeholder="Ex.: proprietários de pequenos salões que organizam horários pelo WhatsApp"
          />
        </label>
        <label htmlFor={`${formId}-brief`}>
          Orientações para a campanha
          <textarea
            id={`${formId}-brief`}
            name="brief"
            value={values.brief}
            onChange={(e) => update("brief", e.target.value)}
            rows={3}
            maxLength={1500}
            placeholder="Mensagem principal, tom e pontos que precisam ser revisados"
            aria-describedby={`${formId}-privacy-help`}
          />
        </label>
        <p className="mk-hint" id={`${formId}-privacy-help`}>
          Use informações da oferta da Web Fidelize. Não inclua senhas, tokens
          ou dados de clientes.
        </p>
        <div className="mk-model-bar">
          <div>
            <strong>Comece com um modelo</strong>
            <p>Texto editável baseado no segmento e no objetivo escolhidos.</p>
          </div>
          <button className="button secondary" type="button" onClick={useModel}>
            <Icon name="briefcase" size={16} /> Usar modelo de texto
          </button>
        </div>
        <p className="mk-model-notice" role="status">
          {modelNotice}
        </p>
        <label htmlFor={`${formId}-headline`}>
          Título
          <input
            id={`${formId}-headline`}
            name="headline"
            value={values.headline}
            onChange={(e) => update("headline", e.target.value)}
            maxLength={120}
            placeholder="Título da propaganda"
          />
        </label>
        <label htmlFor={`${formId}-body`}>
          Texto da propaganda
          <textarea
            id={`${formId}-body`}
            name="body"
            value={values.body}
            onChange={(e) => update("body", e.target.value)}
            rows={8}
            maxLength={2200}
            placeholder="Revise os recursos, a oferta e as condições antes de usar."
          />
        </label>
        <label htmlFor={`${formId}-cta`}>
          Chamada para ação
          <input
            id={`${formId}-cta`}
            name="cta"
            value={values.cta}
            onChange={(e) => update("cta", e.target.value)}
            maxLength={80}
            placeholder="Ex.: Experimentar a demonstração"
          />
        </label>
      </fieldset>
      <Submit
        pending={pending}
        label="Salvar campanha"
        pendingLabel="Salvando campanha…"
      />
      <Feedback state={state} />
    </form>
  );
}

export function CopyText({ text, label }: { text: string; label: string }) {
  const id = useId();
  const [feedback, setFeedback] = useState("");
  const [fallback, setFallback] = useState(false);
  const [pending, setPending] = useState(false);
  async function copy() {
    setPending(true);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setFeedback("Texto copiado.");
      setFallback(false);
    } catch {
      setFallback(true);
      setFeedback(
        "Não foi possível copiar automaticamente. Selecione e copie o texto no campo abaixo.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mk-copy">
      <button
        type="button"
        className="button secondary"
        onClick={() => void copy()}
        disabled={pending || !text}
        aria-describedby={`${id}-feedback`}
      >
        <Icon name="link" size={15} />
        {pending ? "Copiando…" : label}
      </button>
      <p id={`${id}-feedback`} role="status" className="mk-copy-feedback">
        {feedback}
      </p>
      {fallback ? (
        <label className="mk-copy-fallback" htmlFor={`${id}-manual`}>
          Texto para copiar manualmente
          <textarea
            id={`${id}-manual`}
            value={text}
            readOnly
            rows={Math.min(8, Math.max(3, text.split("\n").length))}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}
    </div>
  );
}

export function DownloadArt({ url }: { url: string }) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const id = useId();
  async function download() {
    setPending(true);
    setFeedback("");
    let sourceUrl: string | null = null;
    let outputUrl: string | null = null;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const target = new URL(url, window.location.origin);
      if (
        target.origin !== window.location.origin ||
        target.username ||
        target.password ||
        target.hash ||
        target.search ||
        !/^\/admin\/marketing\/[a-f0-9-]{36}\/arte$/i.test(target.pathname)
      )
        throw new Error("Invalid artwork route");
      const response = await fetch(target, {
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
      });
      if (
        !response.ok ||
        !/^image\/svg\+xml(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      )
        throw new Error("Artwork unavailable");
      const markup = await response.text();
      if (
        markup.length > 2_000_000 ||
        /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(markup)
      )
        throw new Error("Unsupported artwork");
      const document = new DOMParser().parseFromString(markup, "image/svg+xml");
      if (
        document.querySelector("parsererror") ||
        document.documentElement.localName !== "svg" ||
        document.documentElement.namespaceURI !== "http://www.w3.org/2000/svg"
      )
        throw new Error("Invalid SVG artwork");
      for (const element of [
        document.documentElement,
        ...document.documentElement.querySelectorAll("*"),
      ]) {
        if (
          [
            "script",
            "foreignobject",
            "image",
            "use",
            "iframe",
            "style",
            "link",
            "audio",
            "video",
            "feimage",
          ].includes(element.localName.toLowerCase())
        )
          throw new Error("External artwork resources are not allowed");
        for (const attribute of [...element.attributes]) {
          const localName = attribute.localName.toLowerCase();
          // Local gradient references are fine; no URLs or embedded resources
          // may be loaded while the browser renders the SVG into the canvas.
          const value = attribute.value.replace(
            /url\(\s*["']?#[\w:.-]+["']?\s*\)/gi,
            "",
          );
          if (
            /^on/.test(localName) ||
            ["href", "src"].includes(localName) ||
            /url\s*\(|@import|\\/i.test(value)
          )
            throw new Error("External artwork resources are not allowed");
        }
      }
      sourceUrl = URL.createObjectURL(
        new Blob([markup], { type: "image/svg+xml" }),
      );
      const image = new Image();
      const loaded = new Promise<void>((resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Artwork rendering timed out")),
          { once: true },
        );
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("Artwork could not be rendered"));
      });
      image.src = sourceUrl;
      await loaded;
      const canvas = window.document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("PNG unavailable")),
          "image/png",
        ),
      );
      outputUrl = URL.createObjectURL(png);
      const link = window.document.createElement("a");
      link.href = outputUrl;
      link.download = "web-fidelize-modelo-editavel.png";
      window.document.body.append(link);
      link.click();
      link.remove();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      setFeedback(
        "Arte PNG preparada para download. É um modelo gráfico; nenhuma publicação foi realizada.",
      );
    } catch {
      setFeedback(
        "Não foi possível preparar o PNG. Confira sua sessão e tente novamente. Nenhuma publicação foi realizada.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      setPending(false);
    }
  }
  return (
    <div className="mk-copy">
      <button
        className="button secondary"
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-describedby={`${id}-feedback`}
        onClick={() => void download()}
      >
        <Icon name="briefcase" size={16} />
        {pending ? "Preparando PNG…" : "Baixar arte PNG"}
      </button>
      <p id={`${id}-feedback`} role="status" className="mk-copy-feedback">
        {feedback}
      </p>
    </div>
  );
}

export function ReplyBuilder({ origin }: { origin: string }) {
  const id = useId();
  const [kind, setKind] = useState<"comment" | "direct">("comment");
  const [intent, setIntent] = useState<"plans" | "trial" | "support">("plans");
  const [niche, setNiche] = useState("all");
  let reply = "";
  try {
    reply = buildMarketingReply(kind, intent, niche, origin);
  } catch {
    // Invalid deployment origin must not produce a fallback or external link.
  }
  return (
    <section className="mk-reply-builder" aria-labelledby={`${id}-title`}>
      <div className="mk-section-heading">
        <span className="tag">Conversa com clareza</span>
        <h2 id={`${id}-title`}>Sugestões de resposta</h2>
        <p>
          Prepare uma resposta para revisar e copiar. Nenhum comentário ou
          direct é enviado por esta tela.
        </p>
      </div>
      <div className="mk-field-grid mk-field-grid-three">
        <label htmlFor={`${id}-kind`}>
          Onde responder?
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="comment">Comentário</option>
            <option value="direct">Direct</option>
          </select>
        </label>
        <label htmlFor={`${id}-intent`}>
          Assunto
          <select
            id={`${id}-intent`}
            value={intent}
            onChange={(e) => setIntent(e.target.value as typeof intent)}
          >
            <option value="plans">Planos e preços</option>
            <option value="trial">Teste gratuito</option>
            <option value="support">Suporte</option>
          </select>
        </label>
        <label htmlFor={`${id}-niche`}>
          Segmento
          <select
            id={`${id}-niche`}
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
          >
            <option value="all">Todos os segmentos</option>
            {niches.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {reply ? (
        <>
          <label className="mk-reply-output" htmlFor={`${id}-reply`}>
            Modelo de resposta para revisar
            <textarea id={`${id}-reply`} value={reply} readOnly rows={6} />
          </label>
          <CopyText
            key={`${kind}-${intent}-${niche}`}
            text={reply}
            label="Copiar sugestão de resposta"
          />
        </>
      ) : (
        <p role="alert" className="mk-feedback mk-feedback-error">
          Não foi possível preparar os links. Confira a configuração do endereço
          da Web Fidelize.
        </p>
      )}
    </section>
  );
}
