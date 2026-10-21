"use client";
import { useActionState, useEffect, useId, useState } from "react";
import { niches } from "@/lib/catalog";
import {
  salesStages,
  salesTeamSizes,
  salesBudgetRanges,
  salesTimelines,
  salesDecisionRoles,
  type SalesActionState,
  type SalesLead,
  type SalesOffer,
} from "@/lib/sales";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { PendingButton } from "@/components/pending-button";
import {
  salesDateInput,
  salesMoneyInput,
  salesPriorities,
} from "./admin-presenters";

type Action = (
  previous: SalesActionState,
  form: FormData,
) => Promise<SalesActionState>;
type OfferOption = Pick<SalesOffer, "id" | "title" | "active">;
const segments = [
  ...niches.map((niche) => ({
    value: niche.slug as string,
    label: niche.name as string,
  })),
  { value: "outro", label: "Outro segmento" },
];

function Feedback({ state }: { state: SalesActionState }) {
  if (state.error)
    return (
      <p className="notice error" role="alert">
        {state.error}
      </p>
    );
  if (state.success)
    return (
      <p className="notice" role="status">
        {state.success}
      </p>
    );
  return null;
}

export function SalesLeadForm({
  lead,
  offers,
  action,
}: {
  lead?: SalesLead;
  offers: OfferOption[];
  action: Action;
}) {
  const [state, submit, pending] = useActionState(
    action,
    {},
    lead ? `/admin/comercial/${lead.id}` : "/admin/comercial/novo",
  );
  return (
    <>
      <Feedback state={state} />
      <SalesLeadEditor
        key={lead ? `${lead.id}:${lead.version}` : "new"}
        lead={lead}
        offers={offers}
        submit={submit}
        pending={pending}
      />
    </>
  );
}
function SalesLeadEditor({
  lead,
  offers,
  submit,
  pending,
}: {
  lead?: SalesLead;
  offers: OfferOption[];
  submit: (form: FormData) => void;
  pending: boolean;
}) {
  const id = useId();
  const [fields, setFields] = useState({
    offer_id: lead?.offer_id ?? "",
    contact_name: lead?.contact_name ?? "",
    company_name: lead?.company_name ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    niche: lead?.niche ?? "",
    team_size: lead?.team_size ?? "",
    budget_range: lead?.budget_range ?? "",
    timeline: lead?.timeline ?? "",
    decision_role: lead?.decision_role ?? "",
    challenge: lead?.challenge ?? "",
    stage: lead?.stage ?? "new",
    priority: lead?.priority ?? "normal",
    setup_value: salesMoneyInput(lead?.setup_value_cents),
    monthly_value: salesMoneyInput(lead?.monthly_value_cents),
    next_action: lead?.next_action ?? "",
    next_contact_at: salesDateInput(lead?.next_contact_at),
    loss_reason: lead?.loss_reason ?? "",
  });
  const [consent, setConsent] = useState(false);
  const update = (field: keyof typeof fields, value: string) =>
    setFields((previous) => ({ ...previous, [field]: value }));
  return (
    <form action={submit} className="sales-form" aria-busy={pending}>
      <input type="hidden" name="id" value={lead?.id ?? ""} />
      {lead ? (
        <input type="hidden" name="version" value={lead.version} />
      ) : (
        <input type="hidden" name="source" value="manual" />
      )}
      <fieldset disabled={pending}>
        <legend>Contato e empresa</legend>
        <p className="sales-hint">
          Oferta, nome, empresa e telefone são obrigatórios. Complete os demais
          dados quando forem informados pelo contato.
        </p>
        <label htmlFor={`${id}-offer`}>Oferta de interesse *</label>
        <select
          name="offer_id"
          id={`${id}-offer`}
          value={fields.offer_id}
          onChange={(event) => update("offer_id", event.target.value)}
          required
        >
          <option value="">Selecione uma oferta</option>
          {offers.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.title}
              {!offer.active ? " · arquivada" : ""}
            </option>
          ))}
        </select>
        <div className="sales-form-grid">
          <div>
            <label htmlFor={`${id}-contact`}>Nome do contato *</label>
            <input
              name="contact_name"
              id={`${id}-contact`}
              value={fields.contact_name}
              onChange={(event) => update("contact_name", event.target.value)}
              minLength={2}
              maxLength={120}
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={`${id}-company`}>Empresa *</label>
            <input
              name="company_name"
              id={`${id}-company`}
              value={fields.company_name}
              onChange={(event) => update("company_name", event.target.value)}
              minLength={2}
              maxLength={160}
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={`${id}-phone`}>Telefone / WhatsApp *</label>
            <input
              name="phone"
              id={`${id}-phone`}
              type="tel"
              inputMode="tel"
              value={fields.phone}
              onChange={(event) => update("phone", event.target.value)}
              minLength={10}
              maxLength={30}
              required
              autoComplete="off"
              aria-describedby={`${id}-phone-help`}
            />
            <small id={`${id}-phone-help`}>
              Número brasileiro com DDD. O código 55 é opcional.
            </small>
          </div>
          <div>
            <label htmlFor={`${id}-email`}>E-mail</label>
            <input
              name="email"
              id={`${id}-email`}
              type="email"
              value={fields.email}
              onChange={(event) => update("email", event.target.value)}
              maxLength={254}
              autoComplete="off"
            />
          </div>
        </div>
      </fieldset>
      <fieldset disabled={pending}>
        <legend>Qualificação</legend>
        <p className="sales-hint">
          Mantenha em branco o que ainda não foi confirmado. Registre
          necessidades comerciais; não inclua senhas ou dados sensíveis.
        </p>
        <div className="sales-form-grid">
          {(
            [
              { name: "niche", label: "Segmento", options: segments },
              {
                name: "team_size",
                label: "Tamanho da equipe",
                options: salesTeamSizes,
              },
              {
                name: "budget_range",
                label: "Faixa de investimento informada",
                options: salesBudgetRanges,
              },
              {
                name: "timeline",
                label: "Prazo desejado",
                options: salesTimelines,
              },
              {
                name: "decision_role",
                label: "Papel na decisão",
                options: salesDecisionRoles,
              },
            ] as const
          ).map((field) => (
            <div key={field.name}>
              <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
              <select
                id={`${id}-${field.name}`}
                name={field.name}
                value={fields[field.name]}
                onChange={(event) => update(field.name, event.target.value)}
              >
                <option value="">Ainda não informado</option>
                {field.options.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <label htmlFor={`${id}-challenge`}>Principal desafio / objetivo</label>
        <textarea
          id={`${id}-challenge`}
          name="challenge"
          rows={4}
          maxLength={2000}
          value={fields.challenge}
          onChange={(event) => update("challenge", event.target.value)}
        />
        {!lead && (
          <label className="sales-checkbox">
            <input
              name="consent"
              type="checkbox"
              value="yes"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              O contato autorizou retorno sobre esta proposta.
              <small>
                Marque somente se essa autorização foi obtida. O cadastro não
                envia mensagens.
              </small>
            </span>
          </label>
        )}
      </fieldset>
      {lead && (
        <fieldset disabled={pending}>
          <legend>Negociação e próximo passo</legend>
          <div className="sales-form-grid">
            <div>
              <label htmlFor={`${id}-stage`}>Etapa</label>
              <select
                name="stage"
                id={`${id}-stage`}
                value={fields.stage}
                onChange={(event) => update("stage", event.target.value)}
              >
                {salesStages.map((stage) => (
                  <option key={stage.value} value={stage.value}>
                    {stage.value === "won"
                      ? "Fechado comercialmente"
                      : stage.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-priority`}>Prioridade</label>
              <select
                name="priority"
                id={`${id}-priority`}
                value={fields.priority}
                onChange={(event) => update("priority", event.target.value)}
              >
                {salesPriorities.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-setup`}>
                Valor de implantação / projeto (R$)
              </label>
              <input
                name="setup_value"
                id={`${id}-setup`}
                inputMode="decimal"
                value={fields.setup_value}
                onChange={(event) => update("setup_value", event.target.value)}
                maxLength={10}
                aria-describedby={`${id}-values-hint`}
                placeholder="Ainda não definido"
              />
            </div>
            <div>
              <label htmlFor={`${id}-monthly`}>Mensalidade proposta (R$)</label>
              <input
                name="monthly_value"
                id={`${id}-monthly`}
                inputMode="decimal"
                value={fields.monthly_value}
                onChange={(event) =>
                  update("monthly_value", event.target.value)
                }
                maxLength={10}
                aria-describedby={`${id}-values-hint`}
                placeholder="Ainda não definida"
              />
            </div>
          </div>
          <p className="sales-hint" id={`${id}-values-hint`}>
            Use reais, sem separador de milhar: 1500,00. Deixe em branco quando
            o valor não estiver definido. Valores comerciais não comprovam
            recebimento.
          </p>
          <label htmlFor={`${id}-next`}>Próxima ação</label>
          <textarea
            name="next_action"
            id={`${id}-next`}
            rows={2}
            maxLength={500}
            value={fields.next_action}
            onChange={(event) => update("next_action", event.target.value)}
            placeholder="O que precisa acontecer para avançar?"
          />
          <label htmlFor={`${id}-date`}>
            Próximo contato · horário de Brasília
          </label>
          <input
            name="next_contact_at"
            id={`${id}-date`}
            type="datetime-local"
            value={fields.next_contact_at}
            onChange={(event) => update("next_contact_at", event.target.value)}
            aria-describedby={`${id}-date-hint`}
          />
          <small id={`${id}-date-hint`}>
            America/Sao_Paulo (UTC−03). Este registro organiza o retorno; não
            envia lembrete automático.
          </small>
          {fields.stage === "lost" ? (
            <>
              <label htmlFor={`${id}-reason`}>Motivo da perda *</label>
              <textarea
                name="loss_reason"
                id={`${id}-reason`}
                rows={3}
                minLength={3}
                maxLength={1000}
                required
                value={fields.loss_reason}
                onChange={(event) => update("loss_reason", event.target.value)}
              />
            </>
          ) : (
            <input type="hidden" name="loss_reason" value="" />
          )}
          {fields.stage === "won" && (
            <p className="sales-business-note">
              O fechamento é apenas comercial. Esta alteração não ativa
              assinatura, não emite cobrança e não confirma pagamento.
            </p>
          )}
        </fieldset>
      )}
      <div className="sales-form-submit">
        {lead && fields.stage === "lost" ? (
          <ConfirmSubmit
            label="Salvar como perdido"
            description="A negociação será marcada como perdida, com o motivo informado. O contato e o histórico serão preservados. Confira os dados antes de confirmar."
          />
        ) : (
          <PendingButton pendingLabel="Salvando contato…">
            {lead ? "Salvar contato e negociação" : "Cadastrar contato"}
          </PendingButton>
        )}
        <span>
          {lead
            ? "Alterações ficam registradas no histórico."
            : "O contato será criado na etapa Novos contatos."}
        </span>
      </div>
    </form>
  );
}

export function SalesOfferForm({
  offer,
  action,
}: {
  offer?: SalesOffer;
  action: Action;
}) {
  const id = useId();
  const [state, submit, pending] = useActionState(
    action,
    {},
    offer
      ? `/admin/comercial/ofertas?editar=${offer.id}`
      : "/admin/comercial/ofertas",
  );
  const [fields, setFields] = useState({
    slug: offer?.slug ?? "",
    title: offer?.title ?? "",
    summary: offer?.summary ?? "",
    niche: offer?.niche ?? "",
    setup_price: salesMoneyInput(offer?.setup_price_cents),
    monthly_price: salesMoneyInput(offer?.monthly_price_cents),
    active: offer?.active ?? true,
    published: offer?.published ?? false,
  });
  const update = (
    key:
      | "slug"
      | "title"
      | "summary"
      | "niche"
      | "setup_price"
      | "monthly_price",
    value: string,
  ) => setFields((previous) => ({ ...previous, [key]: value }));
  return (
    <form action={submit} className="sales-form" aria-busy={pending}>
      <input type="hidden" name="id" value={offer?.id ?? ""} />
      <Feedback state={state} />
      <fieldset disabled={pending}>
        <legend>Apresentação da oferta</legend>
        <label htmlFor={`${id}-title`}>Nome da oferta *</label>
        <input
          name="title"
          id={`${id}-title`}
          value={fields.title}
          onChange={(event) => update("title", event.target.value)}
          minLength={3}
          maxLength={120}
          required
        />
        <label htmlFor={`${id}-slug`}>Identificador *</label>
        <input
          name="slug"
          id={`${id}-slug`}
          value={fields.slug}
          onChange={(event) => update("slug", event.target.value)}
          minLength={3}
          maxLength={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          aria-describedby={`${id}-slug-hint`}
        />
        <small id={`${id}-slug-hint`}>
          Letras minúsculas, números e hífen, sem espaços.
        </small>
        <label htmlFor={`${id}-summary`}>Descrição comercial *</label>
        <textarea
          name="summary"
          id={`${id}-summary`}
          value={fields.summary}
          onChange={(event) => update("summary", event.target.value)}
          minLength={10}
          maxLength={2000}
          rows={5}
          required
          aria-describedby={`${id}-summary-hint`}
        />
        <small id={`${id}-summary-hint`}>
          Descreva o escopo e as condições reais. HTML não é executado.
        </small>
        <label htmlFor={`${id}-niche`}>Segmento</label>
        <select
          name="niche"
          id={`${id}-niche`}
          value={fields.niche}
          onChange={(event) => update("niche", event.target.value)}
        >
          <option value="">Todos os segmentos</option>
          {segments.map((segment) => (
            <option key={segment.value} value={segment.value}>
              {segment.label}
            </option>
          ))}
        </select>
        <div className="sales-form-grid">
          <div>
            <label htmlFor={`${id}-setup`}>
              Implantação / projeto a partir de (R$)
            </label>
            <input
              name="setup_price"
              id={`${id}-setup`}
              inputMode="decimal"
              maxLength={10}
              value={fields.setup_price}
              onChange={(event) => update("setup_price", event.target.value)}
              placeholder="Sob consulta"
            />
          </div>
          <div>
            <label htmlFor={`${id}-monthly`}>
              Mensalidade a partir de (R$)
            </label>
            <input
              name="monthly_price"
              id={`${id}-monthly`}
              inputMode="decimal"
              maxLength={10}
              value={fields.monthly_price}
              onChange={(event) => update("monthly_price", event.target.value)}
              placeholder="Sob consulta"
            />
          </div>
        </div>
        <p className="sales-hint">
          Use reais sem separador de milhar: 1500,00. Em branco significa sob
          consulta; zero significa valor zero. Estes preços não alteram os
          planos SaaS ou assinaturas.
        </p>
        <label className="sales-checkbox">
          <input
            type="checkbox"
            name="active"
            checked={fields.active}
            onChange={(event) => {
              const active = event.target.checked;
              setFields((previous) => ({
                ...previous,
                active,
                published: active ? previous.published : false,
              }));
            }}
          />
          <span>
            Oferta ativa
            <small>
              Desmarcar arquiva a oferta e retira sua publicação. Os contatos e
              o histórico permanecem.
            </small>
          </span>
        </label>
        <label className="sales-checkbox">
          <input
            type="checkbox"
            name="published"
            checked={fields.published}
            disabled={!fields.active || pending}
            onChange={(event) => {
              const published = event.target.checked;
              setFields((previous) => ({ ...previous, published }));
            }}
          />
          <span>
            Publicar no site comercial
            <small>
              Somente ofertas ativas e publicadas ficam disponíveis ao público.
            </small>
          </span>
        </label>
      </fieldset>
      <div className="sales-form-submit">
        {offer && !fields.active ? (
          <ConfirmSubmit
            label="Arquivar e salvar oferta"
            description="Esta oferta ficará inativa e deixará de ser apresentada ao público. Os contatos existentes e seus históricos serão preservados."
          />
        ) : (
          <PendingButton pendingLabel="Salvando oferta…">
            {offer ? "Salvar oferta" : "Criar oferta"}
          </PendingButton>
        )}
      </div>
    </form>
  );
}

export function SalesNoteForm({
  leadId,
  action,
}: {
  leadId: string;
  action: Action;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [state, submit, pending] = useActionState(
    action,
    {},
    `/admin/comercial/${leadId}`,
  );
  useEffect(() => {
    if (state.success) setBody("");
  }, [state]);
  return (
    <form
      action={submit}
      className="sales-form sales-note-form"
      aria-busy={pending}
    >
      <input name="lead_id" type="hidden" value={leadId} />
      <Feedback state={state} />
      <label htmlFor={`${id}-body`}>Adicionar anotação interna</label>
      <textarea
        name="body"
        id={`${id}-body`}
        rows={4}
        minLength={3}
        maxLength={2000}
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
        readOnly={pending}
        aria-describedby={`${id}-hint`}
      />
      <small id={`${id}-hint`}>
        Registre contexto e combinados. Não inclua senhas ou dados sensíveis. A
        anotação não envia mensagem ao contato.
      </small>
      <PendingButton pendingLabel="Adicionando…">
        Adicionar ao histórico
      </PendingButton>
    </form>
  );
}
