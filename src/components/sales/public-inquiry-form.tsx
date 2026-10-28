"use client";

import Link from "next/link";
import { useActionState, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { submitSalesInquiry } from "@/app/diagnostico/actions";
import { money, niches } from "@/lib/catalog";
import {
  salesTeamSizes,
  salesTimelines,
  salesDecisionRoles,
  type SalesActionState,
  type SalesOffer,
} from "@/lib/sales";
import type { CommercialPlan } from "@/lib/commercial";
import { Icon } from "@/components/ui/icon";

const stages = ["Seu negócio", "Suas prioridades", "Como falar com você"];
type Draft = {
  offer_id: string;
  company_name: string;
  niche: string;
  team_size: string;
  budget_range: string;
  timeline: string;
  decision_role: string;
  challenge: string;
  contact_name: string;
  email: string;
  phone: string;
};
type FieldControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function PublicInquiryForm({
  offers,
  plans,
  selectedOfferId,
  requestId,
  attribution,
  initialChallenge = "",
}: {
  offers: SalesOffer[];
  plans: CommercialPlan[] | null;
  selectedOfferId: string;
  requestId: string;
  attribution: { utm_source: string; utm_medium: string; utm_campaign: string };
  initialChallenge?: string;
}) {
  const [state, action, pending] = useActionState<SalesActionState, FormData>(
    submitSalesInquiry,
    {},
    "/diagnostico",
  );
  const [step, setStep] = useState(0);
  const [validation, setValidation] = useState("");
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    offer_id: selectedOfferId,
    company_name: "",
    niche: "",
    team_size: "",
    budget_range: "",
    timeline: "",
    decision_role: "",
    challenge: initialChallenge,
    contact_name: "",
    email: "",
    phone: "",
  });
  const form = useRef<HTMLFormElement>(null);
  const selectedOffer = offers.find((offer) => offer.id === draft.offer_id);

  function update(field: keyof Draft, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }
  function invalidControl(container: ParentNode | null) {
    return Array.from(
      container?.querySelectorAll<FieldControl>("input, select, textarea") ??
        [],
    ).find((field) => field.willValidate && !field.validity.valid);
  }
  function showInvalid(field: FieldControl) {
    const fieldStep = Number(
      field.closest<HTMLElement>("[data-sales-step]")?.dataset.salesStep,
    );
    flushSync(() => {
      if (
        Number.isInteger(fieldStep) &&
        fieldStep >= 0 &&
        fieldStep < stages.length
      )
        setStep(fieldStep);
      setValidation("Confira o campo destacado antes de continuar.");
    });
    field.focus();
    field.reportValidity();
  }
  function navigate(next: number, validate = false) {
    const invalid = validate
      ? invalidControl(
          form.current?.querySelector(`[data-sales-step="${step}"]`) ?? null,
        )
      : undefined;
    if (invalid) return showInvalid(invalid);
    flushSync(() => {
      setValidation("");
      setStep(next);
    });
    form.current
      ?.querySelector<HTMLElement>(`[data-sales-step="${next}"] legend`)
      ?.focus();
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (step < 2) {
      event.preventDefault();
      navigate(step + 1, true);
      return;
    }
    const invalid = invalidControl(event.currentTarget);
    if (invalid) {
      event.preventDefault();
      showInvalid(invalid);
      return;
    }
    setValidation("");
  }

  if (state.success) {
    return (
      <section
        className="sales-success"
        aria-labelledby="inquiry-success-title"
      >
        <span className="sales-success-icon">
          <Icon name="check" size={28} />
        </span>
        <span className="sales-kicker">PRÓXIMO PASSO</span>
        <h2 id="inquiry-success-title">Sua solicitação foi recebida.</h2>
        <p role="status">{state.success}</p>
        <p>
          A equipe comercial vai usar os dados informados para conversar sobre
          sua necessidade. O envio não agenda uma reunião nem confirma
          contratação.
        </p>
        <a
          className="sales-primary"
          href="https://wa.me/5518997695445?text=Ol%C3%A1!%20Enviei%20uma%20solicita%C3%A7%C3%A3o%20de%20diagn%C3%B3stico%20pelo%20site%20da%20Web%20Fidelize."
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="phone" size={17} /> Continuar no WhatsApp{" "}
          <Icon name="arrow-up-right" size={16} />
        </a>
        <p className="sales-note">
          O botão abre uma conversa. Você decide se deseja enviar a mensagem.
        </p>
        <div className="sales-success-trial">
          <strong>Quer conhecer a plataforma enquanto isso?</strong>
          <p>
            Explore a agenda com dados de exemplo, sem login e sem cartão. A
            demonstração não cria reservas nem inicia uma assinatura.
          </p>
          <Link href="/demonstracao">
            Experimentar demonstração <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form
      ref={form}
      action={action}
      onSubmit={submit}
      noValidate
      className="sales-inquiry-form"
      aria-busy={pending}
    >
      <noscript>
        <style>{`.sales-inquiry-form [data-sales-step][hidden], .sales-inquiry-form .sales-send[hidden] { display: block !important; } .sales-inquiry-form .sales-step-navigation, .sales-form-progress { display: none !important; } .sales-inquiry-form [data-sales-step] + [data-sales-step] { margin-top: 32px; }`}</style>
        <p className="sales-note">
          Preencha as três seções abaixo e envie sua solicitação ao final.
        </p>
      </noscript>
      <input type="hidden" name="request_id" value={requestId} />
      {Object.entries(attribution).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="sales-honeypot" aria-hidden="true">
        <label htmlFor="sales-website">Deixe este campo vazio</label>
        <input
          id="sales-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <div className="sales-form-progress">
        <div>
          <span>Etapa {step + 1} de 3</span>
          <span>Dados mantidos ao voltar</span>
        </div>
        <progress
          value={step + 1}
          max={3}
          aria-label={`Etapa ${step + 1} de 3: ${stages[step]}`}
        />
        <ol aria-label="Etapas do diagnóstico">
          {stages.map((stage, index) => (
            <li
              key={stage}
              aria-current={index === step ? "step" : undefined}
              data-complete={index < step}
            >
              <span aria-hidden="true">
                {index < step ? <Icon name="check" size={13} /> : index + 1}
              </span>
              {stage}
            </li>
          ))}
        </ol>
      </div>
      {state.error ? (
        <p className="sales-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {validation ? (
        <p className="sales-error" role="alert">
          {validation}
        </p>
      ) : null}

      <fieldset data-sales-step={0} hidden={step !== 0} disabled={pending}>
        <legend tabIndex={-1}>Conte sobre o seu negócio.</legend>
        <p className="sales-step-tip">
          Começamos pelo seu contexto para avaliar como a implantação pode
          ajudar.
        </p>
        <label htmlFor="sales-offer">Qual serviço você quer conhecer?</label>
        <select
          id="sales-offer"
          name="offer_id"
          required
          value={draft.offer_id}
          onChange={(event) => update("offer_id", event.target.value)}
          aria-describedby="sales-offer-description"
        >
          <option value="">Selecione uma opção</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.title}
            </option>
          ))}
        </select>
        <div id="sales-offer-description" className="sales-offer-note">
          {selectedOffer ? (
            <>
              <strong>{selectedOffer.title}</strong>
              <p>{selectedOffer.summary}</p>
              <span>
                {selectedOffer.setup_price_cents !== null
                  ? `Implantação: ${money(selectedOffer.setup_price_cents)}.`
                  : "Investimento em implantação sob consulta."}
                {selectedOffer.monthly_price_cents !== null
                  ? ` Referência mensal: ${money(selectedOffer.monthly_price_cents)}.`
                  : ""}{" "}
                Escopo e condições confirmados na proposta.
              </span>
            </>
          ) : (
            <p>
              Escolha o serviço para ver seu escopo publicado. A solicitação não
              gera cobrança.
            </p>
          )}
        </div>
        <label htmlFor="sales-company">Nome da empresa</label>
        <input
          id="sales-company"
          name="company_name"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={160}
          value={draft.company_name}
          onChange={(event) => update("company_name", event.target.value)}
          placeholder="Como seu negócio se chama?"
        />
        <div className="sales-fields-row">
          <div>
            <label htmlFor="sales-niche">Segmento</label>
            <select
              id="sales-niche"
              name="niche"
              required
              value={draft.niche}
              onChange={(event) => update("niche", event.target.value)}
            >
              <option value="">Selecione</option>
              {niches.map((niche) => (
                <option key={niche.slug} value={niche.slug}>
                  {niche.name}
                </option>
              ))}
              <option value="outro">Outro segmento</option>
            </select>
          </div>
          <div>
            <label htmlFor="sales-team-size">Tamanho da equipe</label>
            <select
              id="sales-team-size"
              name="team_size"
              required
              value={draft.team_size}
              onChange={(event) => update("team_size", event.target.value)}
            >
              <option value="">Selecione</option>
              {salesTeamSizes.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset data-sales-step={1} hidden={step !== 1} disabled={pending}>
        <legend tabIndex={-1}>O que precisa funcionar melhor?</legend>
        <p className="sales-step-tip">
          Não precisa ter tudo definido. Conte o que mais toma tempo na sua
          rotina.
        </p>
        <label htmlFor="sales-challenge">Descreva o que você busca</label>
        <textarea
          id="sales-challenge"
          name="challenge"
          required
          minLength={10}
          maxLength={2000}
          rows={5}
          value={draft.challenge}
          onChange={(event) => update("challenge", event.target.value)}
          aria-describedby="sales-challenge-tip"
          placeholder="Ex.: organizar os horários de três profissionais e começar a receber reservas pelo site."
        />
        <p className="sales-note" id="sales-challenge-tip">
          Escreva pelo menos 10 caracteres. Não inclua senhas, dados de
          pacientes ou informações pessoais de clientes.
        </p>
        <label htmlFor="sales-budget">
          Qual plano combina com o que você busca?
        </label>
        <select
          id="sales-budget"
          name="budget_range"
          required
          value={draft.budget_range}
          onChange={(event) => update("budget_range", event.target.value)}
        >
          <option value="">Selecione</option>
          {(plans || [])
            .filter((plan) =>
              ["essencial", "profissional", "empresarial"].includes(plan.id),
            )
            .map((plan) => (
              <option key={plan.id} value={`plan-${plan.id}`}>
                {plan.name} · {money(plan.cents)}/mês · até {plan.staff}{" "}
                {plan.staff === 1 ? "profissional" : "profissionais"}
              </option>
            ))}
          <option value="other">Outros / quero orientação</option>
        </select>
        <p className="sales-note">
          Escolha apenas uma opção. Isso indica seu interesse, sem contratar ou
          cobrar. O acompanhamento de implantação tem orçamento separado.
          {plans === null
            ? " Os preços não carregaram agora; escolha Outros para receber orientação."
            : ""}
        </p>
        <div className="sales-fields-row">
          <div>
            <label htmlFor="sales-timeline">Quando pretende começar?</label>
            <select
              id="sales-timeline"
              name="timeline"
              required
              value={draft.timeline}
              onChange={(event) => update("timeline", event.target.value)}
            >
              <option value="">Selecione</option>
              {salesTimelines.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sales-role">Seu papel na empresa</label>
            <select
              id="sales-role"
              name="decision_role"
              required
              value={draft.decision_role}
              onChange={(event) => update("decision_role", event.target.value)}
            >
              <option value="">Selecione</option>
              {salesDecisionRoles.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset data-sales-step={2} hidden={step !== 2} disabled={pending}>
        <legend tabIndex={-1}>Como podemos falar com você?</legend>
        <p className="sales-step-tip">
          Vamos usar estes contatos para conversar sobre a solicitação e os
          próximos passos.
        </p>
        <label htmlFor="sales-contact">Seu nome</label>
        <input
          id="sales-contact"
          name="contact_name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          value={draft.contact_name}
          onChange={(event) => update("contact_name", event.target.value)}
          placeholder="Seu nome e sobrenome"
        />
        <label htmlFor="sales-email">E-mail</label>
        <input
          id="sales-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.email}
          onChange={(event) => update("email", event.target.value)}
          placeholder="voce@empresa.com.br"
        />
        <label htmlFor="sales-phone">WhatsApp com DDD</label>
        <input
          id="sales-phone"
          name="phone"
          type="tel"
          required
          maxLength={30}
          autoComplete="tel"
          inputMode="tel"
          value={draft.phone}
          onChange={(event) => update("phone", event.target.value)}
          placeholder="(18) 99999-9999"
        />
        <label className="sales-consent" htmlFor="sales-consent">
          <input
            id="sales-consent"
            name="consent"
            value="yes"
            type="checkbox"
            required
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Autorizo o contato da Web Fidelize sobre esta solicitação por
            WhatsApp ou e-mail.
          </span>
        </label>
        <p className="sales-note">
          As informações ficam com a equipe comercial da Web Fidelize para
          avaliar esta solicitação. Não inclua dados sensíveis. O envio não
          agenda uma reunião nem contrata um serviço.
        </p>
      </fieldset>

      <div className="sales-form-actions">
        <div className="sales-step-navigation">
          {step > 0 ? (
            <button
              type="button"
              className="sales-back"
              disabled={pending}
              onClick={() => navigate(step - 1)}
            >
              <Icon name="chevron-left" size={16} /> Voltar
            </button>
          ) : (
            <span className="sales-note">
              Todos os campos são obrigatórios.
            </span>
          )}
          {step < 2 ? (
            <button
              type="button"
              className="sales-primary"
              onClick={() => navigate(step + 1, true)}
            >
              Continuar <Icon name="arrow-right" size={16} />
            </button>
          ) : null}
        </div>
        <button
          type="submit"
          className="sales-primary sales-send"
          hidden={step !== 2}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? (
            <>
              <span className="ui-spinner" aria-hidden="true" /> Enviando
              solicitação…
            </>
          ) : (
            <>
              Solicitar diagnóstico <Icon name="arrow-right" size={16} />
            </>
          )}
        </button>
      </div>
      <p className="sales-save-note" role="status" aria-live="polite">
        {pending
          ? "Aguarde a confirmação de recebimento nesta página."
          : "As informações só são enviadas ao concluir. Você pode voltar às etapas sem perder o que preencheu nesta página."}
      </p>
    </form>
  );
}
