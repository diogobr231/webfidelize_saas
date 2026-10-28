"use client";

import { useActionState, useId, useRef, useState } from "react";
import { PendingButton } from "@/components/pending-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Icon } from "@/components/ui/icon";
import type { CommercialPlan } from "@/lib/commercial";
import type {
  BillingActionState,
  BillingCheckout,
  BillingSnapshot,
} from "@/lib/billing/types";
import { money } from "@/lib/catalog";
import { teamPlanBenefits } from "@/lib/plan-benefits";
import { cancelCard, refreshBilling, startCard, startPix } from "./actions";

const initial: BillingActionState = {};
const sharedBenefits = [
  "Agenda individual e turmas com limite de vagas",
  "Clientes, serviços e página de agendamento",
  "Importação da agenda por ICS ou CSV",
  "Configuração guiada e central de ajuda",
];
const statuses: Record<string, string> = {
  creating: "Preparando cobrança",
  unknown: "Aguardando verificação",
  completed: "Processamento concluído",
  created: "Aguardando processamento",
  pending: "Aguardando pagamento",
  in_process: "Em análise",
  processing: "Em processamento",
  authorized: "Recorrência autorizada",
  approved: "Pagamento aprovado",
  rejected: "Pagamento recusado",
  cancelled: "Cancelado",
  canceled: "Cancelado",
  expired: "Prazo encerrado",
  refunded: "Estornado",
  charged_back: "Pagamento contestado",
  paused: "Recorrência pausada",
  failed: "Não concluído",
};
const closedCheckout = new Set([
  "completed",
  "approved",
  "rejected",
  "cancelled",
  "canceled",
  "expired",
  "refunded",
  "charged_back",
  "failed",
]);

function formatDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(new Date(value).getTime()))
    return "Aguardando confirmação";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function Feedback({ state }: { state: BillingActionState }) {
  return (
    <>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice" role="status">
          {state.success}
        </p>
      )}
    </>
  );
}

function CompanyFields({
  companyId,
  planId,
  amountCents,
}: {
  companyId: string;
  planId?: string;
  amountCents?: number;
}) {
  return (
    <>
      <input type="hidden" name="company_id" value={companyId} />
      {planId && <input type="hidden" name="plan_id" value={planId} />}
      {amountCents !== undefined && (
        <input type="hidden" name="quoted_amount_cents" value={amountCents} />
      )}
    </>
  );
}

function RefreshForm({ companyId }: { companyId: string }) {
  const [state, submit] = useActionState(refreshBilling, initial);
  return (
    <form action={submit} className="billing-inline-form">
      <CompanyFields companyId={companyId} />
      <PendingButton
        className="secondary"
        pendingLabel="Consultando Mercado Pago…"
      >
        Verificar pagamento
      </PendingButton>
      <Feedback state={state} />
    </form>
  );
}

function CardForm({
  companyId,
  planId,
  amountCents,
  resume = false,
}: {
  companyId: string;
  planId: string;
  amountCents: number;
  resume?: boolean;
}) {
  const [state, submit] = useActionState(startCard, initial);
  return (
    <form action={submit} className="billing-payment-form">
      <CompanyFields
        companyId={companyId}
        planId={planId}
        amountCents={amountCents}
      />
      <p>
        Você informa os dados do cartão no ambiente seguro do Mercado Pago. A
        renovação é mensal e automática até o cancelamento.
      </p>
      <PendingButton pendingLabel="Abrindo pagamento seguro…">
        {resume ? "Continuar no Mercado Pago" : "Assinar com cartão"}
        <Icon name="arrow-up-right" size={16} />
      </PendingButton>
      <Feedback state={state} />
    </form>
  );
}

function PixForm({
  companyId,
  planId,
  amountCents,
}: {
  companyId: string;
  planId: string;
  amountCents: number;
}) {
  const [state, submit] = useActionState(startPix, initial);
  const id = useId();
  return (
    <form action={submit} className="billing-payment-form">
      <CompanyFields
        companyId={companyId}
        planId={planId}
        amountCents={amountCents}
      />
      <p>
        Pagamento único para o período mensal. O Pix não renova automaticamente;
        você escolhe quando pagar o próximo período.
      </p>
      <label htmlFor={`${id}-cpf`}>
        CPF do pagador
        <input
          id={`${id}-cpf`}
          name="cpf"
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          maxLength={14}
          minLength={11}
          pattern="[0-9.\-\s]{11,14}"
          required
          aria-describedby={`${id}-cpf-hint`}
        />
      </label>
      <small id={`${id}-cpf-hint`}>
        Exigido pelo Mercado Pago para gerar o Pix. O CPF não fica salvo no
        cadastro da empresa.
      </small>
      <PendingButton pendingLabel="Gerando Pix…">
        Gerar Pix
        <Icon name="arrow-right" size={16} />
      </PendingButton>
      <Feedback state={state} />
    </form>
  );
}

function PixCode({ checkout }: { checkout: BillingCheckout }) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const qrImage =
    checkout.qr_code_base64 &&
    checkout.qr_code_base64.length <= 300_000 &&
    /^iVBORw0KGgo[A-Za-z0-9+/=\r\n]+$/.test(checkout.qr_code_base64)
      ? `data:image/png;base64,${checkout.qr_code_base64}`
      : null;
  async function copyCode() {
    if (!checkout.qr_code) return;
    try {
      await navigator.clipboard.writeText(checkout.qr_code);
      setCopyMessage("Código Pix copiado. Cole no aplicativo do seu banco.");
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopyMessage(
        "Selecione e copie o código no campo abaixo para usar no seu banco.",
      );
    }
  }
  return (
    <div className="billing-pix-code">
      {qrImage && (
        <img
          src={qrImage}
          width="200"
          height="200"
          alt="QR Code Pix desta cobrança"
        />
      )}
      <div>
        {checkout.qr_code ? (
          <>
            <label htmlFor={`${id}-pix`}>
              Pix copia e cola
              <textarea
                ref={field}
                id={`${id}-pix`}
                readOnly
                value={checkout.qr_code}
                rows={3}
                spellCheck={false}
              />
            </label>
            <button type="button" className="secondary" onClick={copyCode}>
              <Icon name="copy" size={16} />
              Copiar código Pix
            </button>
            <p className="billing-copy-status" role="status">
              {copyMessage}
            </p>
          </>
        ) : (
          <p>
            O código ainda não está disponível. Use “Verificar pagamento” para
            consultar esta cobrança.
          </p>
        )}
      </div>
    </div>
  );
}

function CheckoutPanel({
  companyId,
  snapshot,
  plans,
  trialActive,
  serverNow,
  isDemo,
}: {
  companyId: string;
  snapshot: BillingSnapshot;
  plans: CommercialPlan[] | null;
  trialActive: boolean;
  serverNow: number;
  isDemo: boolean;
}) {
  const checkout = snapshot.checkout;
  if (!checkout || checkout.environment !== snapshot.configuration.environment)
    return null;
  const open = !closedCheckout.has(checkout.status);
  const expired =
    checkout.expires_at !== null &&
    new Date(checkout.expires_at).getTime() <= serverNow;
  const plan = plans?.find((entry) => entry.id === checkout.plan_id);
  return (
    <section
      className="panel billing-checkout"
      aria-labelledby="billing-checkout-title"
    >
      <div className="billing-section-heading">
        <div>
          <span className="billing-eyebrow">Cobrança mais recente</span>
          <h2 id="billing-checkout-title">
            {plan?.name || "Plano selecionado"} · {money(checkout.amount_cents)}
          </h2>
        </div>
        <span className="billing-status">
          {statuses[checkout.status] || "Em verificação"}
        </span>
      </div>
      {checkout.environment === "test" && (
        <p className="notice">
          Cobrança de teste. Mesmo aprovada, ela não libera acesso pago à
          empresa.
        </p>
      )}
      {open && checkout.method === "pix" && !expired && (
        <>
          <p>
            Abra o aplicativo do banco, escolha Pix e escaneie o QR Code ou cole
            o código. Confira o valor antes de concluir.
          </p>
          <PixCode key={checkout.id} checkout={checkout} />
        </>
      )}
      {open && checkout.method === "pix" && expired && (
        <p className="notice">
          O prazo deste Pix terminou. Verifique o pagamento antes de iniciar uma
          nova cobrança.
        </p>
      )}
      {open &&
        checkout.method === "card" &&
        !trialActive &&
        !isDemo &&
        checkout.checkout_url &&
        snapshot.configuration.enabled && (
          <CardForm
            companyId={companyId}
            planId={checkout.plan_id}
            amountCents={checkout.amount_cents}
            resume
          />
        )}
      {open && checkout.method === "card" && !checkout.checkout_url && (
        <p>
          O link do cartão ainda não está disponível. Verifique esta tentativa
          antes de iniciar uma nova cobrança.
        </p>
      )}
      {checkout.expires_at && (
        <p className="billing-caption">
          Válido até {formatDate(checkout.expires_at)} (horário de Brasília).
        </p>
      )}
      {open && (
        <p className="billing-caption">
          Abrir o checkout ou copiar o Pix não libera o plano. A confirmação é
          recebida e validada pelo servidor.
        </p>
      )}
      {snapshot.configuration.enabled && <RefreshForm companyId={companyId} />}
    </section>
  );
}

function SubscriptionPanel({
  companyId,
  snapshot,
  plans,
}: {
  companyId: string;
  snapshot: BillingSnapshot;
  plans: CommercialPlan[] | null;
}) {
  const [state, submit] = useActionState(cancelCard, initial);
  const subscription = snapshot.subscription;
  if (
    !subscription ||
    subscription.environment !== snapshot.configuration.environment
  )
    return null;
  const cancelled = ["cancelled", "canceled"].includes(subscription.status);
  return (
    <section
      className="panel billing-subscription"
      aria-labelledby="billing-recurring-title"
    >
      <div className="billing-section-heading">
        <div>
          <span className="billing-eyebrow">Cartão · renovação mensal</span>
          <h2 id="billing-recurring-title">
            {plans?.find((plan) => plan.id === subscription.plan_id)?.name ||
              "Assinatura recorrente"}
          </h2>
        </div>
        <span className="billing-status">
          {statuses[subscription.status] || "Em verificação"}
        </span>
      </div>
      <p>
        {cancelled
          ? "A renovação desta assinatura foi cancelada."
          : "A autorização da recorrência não substitui a confirmação de cada pagamento. Consulte o período de acesso e o histórico abaixo."}
      </p>
      {subscription.environment === "test" && (
        <p className="notice">
          Assinatura de teste. Este registro não comprova cobrança real nem
          libera acesso pago.
        </p>
      )}
      {!cancelled && subscription.next_payment_at && (
        <p>
          Próxima cobrança prevista:{" "}
          <strong>{formatDate(subscription.next_payment_at)}</strong>.
        </p>
      )}
      {!cancelled && snapshot.configuration.enabled && (
        <form action={submit} className="billing-inline-form">
          <CompanyFields companyId={companyId} planId={subscription.plan_id} />
          <ConfirmSubmit
            label="Cancelar renovação automática"
            description="Deseja solicitar o cancelamento da renovação no Mercado Pago? A alteração será exibida após a confirmação. O período já pago permanece conforme a data de acesso informada."
          />
          <Feedback state={state} />
        </form>
      )}
      {snapshot.configuration.enabled && <RefreshForm companyId={companyId} />}
    </section>
  );
}

function PaymentHistory({ snapshot }: { snapshot: BillingSnapshot }) {
  return (
    <section
      className="panel billing-history"
      aria-labelledby="billing-history-title"
    >
      <span className="billing-eyebrow">Transparência em cada período</span>
      <h2 id="billing-history-title">Histórico de pagamentos</h2>
      {snapshot.payments.length ? (
        <ul className="billing-payment-list">
          {snapshot.payments.map((payment) => (
            <li key={`${payment.environment}:${payment.provider_id}`}>
              <div>
                <strong>{payment.method === "pix" ? "Pix" : "Cartão"}</strong>
                {payment.environment === "test" && (
                  <small>Teste · sem cobrança real</small>
                )}
                <small>
                  {formatDate(payment.approved_at || payment.created_at)}
                </small>
              </div>
              <span className="billing-status">
                {statuses[payment.status] || "Em verificação"}
              </span>
              <strong>{money(payment.amount_cents)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <div className="billing-empty">
          <Icon name="shield" size={30} />
          <div>
            <strong>Ainda não há pagamentos registrados</strong>
            <p>
              As cobranças aparecerão aqui após a consulta e validação pelo
              servidor.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function BillingForm({
  companyId,
  plans,
  currentPlanId,
  professionalCount,
  snapshot,
  owner,
  trialActive,
  serverNow,
  isDemo,
}: {
  companyId: string;
  plans: CommercialPlan[] | null;
  currentPlanId: string;
  professionalCount: number | null;
  snapshot: BillingSnapshot | null;
  owner: boolean;
  trialActive: boolean;
  serverNow: number;
  isDemo: boolean;
}) {
  const id = useId();
  const [selected, setSelected] = useState(currentPlanId);
  const [method, setMethod] = useState<"pix" | "card">("pix");
  const subscriptionOpen =
    !!snapshot?.subscription &&
    snapshot.subscription.environment === snapshot.configuration.environment &&
    !["cancelled", "canceled"].includes(snapshot.subscription.status);
  const openCheckout =
    !!snapshot?.checkout &&
    snapshot.checkout.environment === snapshot.configuration.environment &&
    !closedCheckout.has(snapshot.checkout.status);
  const eligibleStatus =
    !!snapshot &&
    ["trialing", "past_due", "active"].includes(snapshot.company.status);
  const paidCurrentPeriod =
    !!snapshot?.company.paid_until &&
    new Date(snapshot.company.paid_until).getTime() > serverNow;
  const manualRenewal = paidCurrentPeriod && !subscriptionOpen;
  const requiresAccessReview =
    paidCurrentPeriod && snapshot?.company.access === false;
  const plan =
    plans?.find(
      (entry) => entry.id === (manualRenewal ? currentPlanId : selected),
    ) || plans?.[0];
  const canPurchase =
    owner &&
    !isDemo &&
    snapshot?.configuration.enabled === true &&
    !trialActive &&
    eligibleStatus &&
    !subscriptionOpen &&
    !openCheckout &&
    !requiresAccessReview &&
    professionalCount !== null;
  const planFits =
    !!plan && professionalCount !== null && professionalCount <= plan.staff;

  return (
    <div className="billing-workspace">
      {isDemo && (
        <p className="notice">
          Esta é uma empresa de demonstração. Cobranças não podem ser iniciadas
          com este cadastro.
        </p>
      )}
      {owner && requiresAccessReview && (
        <p className="notice">
          Existe um período pago registrado, mas o acesso precisa ser conferido.
          Fale com o suporte antes de iniciar outra cobrança.
        </p>
      )}
      {owner && snapshot?.configuration.environment === "test" && (
        <p className="notice billing-test-banner" role="status">
          <Icon name="shield" size={20} />
          <span>
            <strong>Ambiente de testes do Mercado Pago.</strong> Use somente
            contas e dados de teste. Nenhum resultado deste ambiente libera
            acesso pago.
          </span>
        </p>
      )}
      {owner && !snapshot && (
        <p className="notice error" role="alert">
          Não foi possível consultar as cobranças agora. Atualize a página ou
          fale com o suporte. Nenhuma nova cobrança foi iniciada.
        </p>
      )}
      {owner && snapshot && !snapshot.configuration.enabled && (
        <p className="notice">
          A contratação online ainda não está habilitada. Seu teste e os dados
          da empresa seguem os prazos informados acima. Para continuar após o
          teste, fale com a Web Fidelize.
        </p>
      )}
      {trialActive && (
        <div className="billing-trial-message">
          <Icon name="clock" size={22} />
          <div>
            <strong>Aproveite seus 7 dias grátis, sem cartão.</strong>
            <p>
              A contratação fica disponível depois do fim do teste. Nenhuma
              cobrança automática é iniciada durante esse período.
            </p>
          </div>
        </div>
      )}

      <section aria-labelledby="billing-plans-title">
        <div className="billing-section-heading">
          <div>
            <span className="billing-eyebrow">
              Um plano para o tamanho da sua equipe
            </span>
            <h2 id="billing-plans-title">Escolha como continuar</h2>
          </div>
          <span className="billing-caption">Valores mensais · em reais</span>
        </div>
        {!plans?.length ? (
          <p className="notice error" role="alert">
            Não foi possível consultar os planos. Atualize a página para
            consultar os preços antes de contratar.
          </p>
        ) : (
          <fieldset className="billing-plan-picker" disabled={!canPurchase}>
            <legend className="billing-sr-only">Plano da assinatura</legend>
            {plans.map((entry) => {
              const capacityExceeded =
                professionalCount !== null && professionalCount > entry.staff;
              const currentPeriodOtherPlan =
                manualRenewal && entry.id !== currentPlanId;
              return (
                <label
                  key={entry.id}
                  className={`billing-plan${canPurchase && plan?.id === entry.id ? " is-selected" : ""}${entry.id === "profissional" ? " is-recommended" : ""}`}
                  htmlFor={`${id}-${entry.id}`}
                >
                  <div className="billing-plan-flags">
                    <span>
                      {entry.id === "profissional"
                        ? "Recomendado para equipes"
                        : entry.id === currentPlanId
                          ? "Plano atual"
                          : "Para sua rotina"}
                    </span>
                    {canPurchase && (
                      <input
                        id={`${id}-${entry.id}`}
                        type="radio"
                        name={`${id}-plan-choice`}
                        value={entry.id}
                        checked={plan?.id === entry.id}
                        disabled={capacityExceeded || currentPeriodOtherPlan}
                        onChange={() => setSelected(entry.id)}
                      />
                    )}
                  </div>
                  <h3>{entry.name}</h3>
                  <p className="billing-plan-price">
                    {money(entry.cents)}
                    <small>/mês</small>
                  </p>
                  <p>
                    Até{" "}
                    <strong>
                      {entry.staff}{" "}
                      {entry.staff === 1 ? "profissional" : "profissionais"}
                    </strong>{" "}
                    na agenda
                  </p>
                  <ul>
                    {[...sharedBenefits, ...teamPlanBenefits(entry)].map(
                      (benefit) => (
                        <li key={benefit}>
                          <Icon name="check" size={16} />
                          {benefit}
                        </li>
                      ),
                    )}
                  </ul>
                  {capacityExceeded && (
                    <p className="billing-plan-warning">
                      Sua equipe atual excede o limite deste plano.
                    </p>
                  )}
                  {currentPeriodOtherPlan && (
                    <p className="billing-caption">
                      Mudanças de plano ficam disponíveis ao terminar o período
                      pago.
                    </p>
                  )}
                  {!canPurchase && owner && (
                    <a
                      className="button secondary"
                      href={`https://wa.me/5518997695445?text=${encodeURIComponent(`Olá! Quero informações sobre o plano ${entry.name} da Web Fidelize, de ${money(entry.cents)} por mês.`)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Falar sobre este plano
                      <Icon name="arrow-up-right" size={16} />
                    </a>
                  )}
                  {!owner && (
                    <p className="billing-caption">
                      A contratação é gerenciada pelo proprietário.
                    </p>
                  )}
                </label>
              );
            })}
          </fieldset>
        )}
      </section>

      {canPurchase && plan && planFits && (
        <section
          className="panel billing-payment-selection"
          aria-labelledby="billing-payment-title"
        >
          <div className="billing-section-heading">
            <div>
              <span className="billing-eyebrow">
                {manualRenewal ? "Renovação do seu plano" : "Próximo passo"}
              </span>
              <h2 id="billing-payment-title">
                {plan.name} · {money(plan.cents)}/mês
              </h2>
            </div>
            <Icon name="shield" size={25} />
          </div>
          {manualRenewal && (
            <p>
              O período já pago será preservado. A renovação antecipada está
              disponível por Pix para o plano atual.
            </p>
          )}
          <fieldset className="billing-method-picker">
            <legend>Como prefere pagar?</legend>
            <label>
              <input
                type="radio"
                name={`${id}-method`}
                value="pix"
                checked={method === "pix" || manualRenewal}
                onChange={() => setMethod("pix")}
              />
              <span>
                <strong>Pix</strong>
                <small>Pagamento mensal, sem renovação automática</small>
              </span>
            </label>
            {!manualRenewal && (
              <label>
                <input
                  type="radio"
                  name={`${id}-method`}
                  value="card"
                  checked={method === "card"}
                  onChange={() => setMethod("card")}
                />
                <span>
                  <strong>Cartão</strong>
                  <small>Assinatura com renovação automática</small>
                </span>
              </label>
            )}
          </fieldset>
          {method === "pix" || manualRenewal ? (
            <PixForm
              key={`pix-${plan.id}`}
              companyId={companyId}
              planId={plan.id}
              amountCents={plan.cents}
            />
          ) : (
            <CardForm
              key={`card-${plan.id}`}
              companyId={companyId}
              planId={plan.id}
              amountCents={plan.cents}
            />
          )}
          <p className="billing-caption">
            O acesso só muda após a confirmação do pagamento no servidor. A Web
            Fidelize não solicita nem armazena os dados do seu cartão.
          </p>
        </section>
      )}
      {owner && professionalCount === null && (
        <p className="notice error" role="alert">
          Não foi possível conferir o tamanho da equipe. Atualize a página antes
          de contratar.
        </p>
      )}
      {owner && snapshot && (
        <>
          <CheckoutPanel
            companyId={companyId}
            snapshot={snapshot}
            plans={plans}
            trialActive={trialActive}
            serverNow={serverNow}
            isDemo={isDemo}
          />
          <SubscriptionPanel
            companyId={companyId}
            snapshot={snapshot}
            plans={plans}
          />
          <PaymentHistory snapshot={snapshot} />
        </>
      )}
      <div className="billing-footnote">
        <Icon name="help" size={20} />
        <p>
          O proprietário ocupa uma vaga quando também atende. Convites de acesso
          e profissionais da agenda são cadastros diferentes. Avisos por
          WhatsApp dependem de configuração e cota próprias. Precisa de ajuda?{" "}
          <a
            href="https://wa.me/5518997695445"
            target="_blank"
            rel="noreferrer"
          >
            Fale com a Web Fidelize.
          </a>
        </p>
      </div>
    </div>
  );
}
