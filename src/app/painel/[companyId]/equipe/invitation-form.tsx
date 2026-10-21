"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { PendingButton } from "@/components/pending-button";
import {
  invitationErrorMessages,
  type InvitationActionState,
} from "@/lib/team";
import { invitationDeliveryMessages } from "@/lib/team-mail-content";
import { invite, resendInvitation } from "./actions";

function InvitationResult({
  state,
  renewed,
}: {
  state: InvitationActionState;
  renewed: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (state.error)
    return (
      <p className="notice error" role="alert">
        {invitationErrorMessages[state.error] ||
          invitationErrorMessages.convite}
      </p>
    );
  if (!state.issue || !state.url) return null;
  return (
    <div
      className="notice team-invite-result"
      role="status"
      data-invitation-delivery={state.delivery || "not_requested"}
    >
      <Icon name="link" size={20} />
      <div>
        <strong>
          {renewed
            ? "Novo link gerado. O link anterior foi invalidado."
            : "Convite gerado."}
        </strong>
        <p>
          Compartilhe somente com {state.issue.email}. O e-mail precisa ser
          confirmado antes do aceite.
        </p>
        <p className="team-invite-url">
          <a href={state.url} target="_blank" rel="noopener noreferrer">
            {state.url}
          </a>
        </p>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(state.url!);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? "Link copiado" : "Copiar link"}
        </button>
        {copyError && (
          <p>Selecione o link acima e copie pelo seu dispositivo.</p>
        )}
        <p>
          Válido até{" "}
          {new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "America/Sao_Paulo",
          }).format(new Date(state.issue.expires_at))}{" "}
          (horário de Brasília).
        </p>
        <p>{invitationDeliveryMessages[state.delivery || "not_requested"]}</p>
      </div>
    </div>
  );
}

function EmailOption({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <label className="team-invite-email">
      <input type="checkbox" name="send_email" value="yes" /> Enviar este
      convite também por e-mail
    </label>
  ) : (
    <p className="operations-field-note">
      Envio por e-mail ainda indisponível. Compartilhe o link individual com seu
      colaborador.
    </p>
  );
}

export function InvitationForm({
  companyId,
  deliveryEnabled,
}: {
  companyId: string;
  deliveryEnabled: boolean;
}) {
  const [state, action] = useActionState(invite, {});
  return (
    <>
      <form
        action={action}
        className="operations-form"
        data-invitation-email-enabled={String(deliveryEnabled)}
      >
        <input name="company_id" type="hidden" value={companyId} />
        <label htmlFor="email">E-mail do colaborador</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="nome@empresa.com"
          autoComplete="email"
          maxLength={254}
          required
        />
        <label htmlFor="role">Permissão</label>
        <select id="role" name="role">
          <option value="EMPLOYEE">
            Colaborador: agenda atribuída e clientes relacionados
          </option>
          <option value="MANAGER">
            Gerente: cadastros e agenda da empresa
          </option>
        </select>
        <p className="operations-field-note">
          <Icon name="shield" size={14} /> O convite permite um único aceite e
          expira em 48 horas. Convites pendentes não reservam vagas no plano.
        </p>
        <EmailOption enabled={deliveryEnabled} />
        <PendingButton pendingLabel="Preparando convite…">
          Gerar convite de uso único <Icon name="arrow-right" size={16} />
        </PendingButton>
      </form>
      <InvitationResult
        key={state.issue?.issue_id || state.error || "empty"}
        state={state}
        renewed={false}
      />
    </>
  );
}

export function InvitationRenewal({
  companyId,
  invitationId,
  deliveryEnabled,
}: {
  companyId: string;
  invitationId: string;
  deliveryEnabled: boolean;
}) {
  const [state, action] = useActionState(resendInvitation, {});
  return (
    <div className="team-invite-renewal">
      <form action={action}>
        <input name="company_id" type="hidden" value={companyId} />
        <input name="invitation_id" type="hidden" value={invitationId} />
        <EmailOption enabled={deliveryEnabled} />
        <PendingButton
          className="secondary"
          pendingLabel="Preparando novo link…"
        >
          Gerar novo link
        </PendingButton>
      </form>
      <InvitationResult
        key={state.issue?.issue_id || state.error || "empty"}
        state={state}
        renewed
      />
    </div>
  );
}
