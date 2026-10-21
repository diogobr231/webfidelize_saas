"use client";

import { useActionState, useEffect, useState } from "react";
import { resendConfirmation, type ResendState } from "./actions";

export function ResendConfirmationForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<ResendState, FormData>(
    resendConfirmation,
    {},
  );
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const sentAt = state.sentAt;
    if (!sentAt) return;
    const secondsLeft = () =>
      Math.max(0, Math.ceil((sentAt + 60_000 - Date.now()) / 1000));
    setRemaining(secondsLeft());
    if (secondsLeft() === 0) return;
    const timer = window.setInterval(() => {
      const seconds = secondsLeft();
      setRemaining(seconds);
      if (seconds === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.sentAt]);
  return (
    <details
      className="auth-segments"
      open={Boolean(state.error || state.sentAt)}
    >
      <summary>Não recebeu a confirmação do cadastro?</summary>
      <p className="auth-access-note">
        Confira também a pasta de spam. Aguarde pelo menos um minuto entre
        solicitações.
      </p>
      {state.error ? (
        <p role="alert" className="notice error">
          {state.error}
        </p>
      ) : null}
      {state.sentAt ? (
        <p role="status" className="notice">
          Se houver um cadastro aguardando confirmação, enviaremos um novo link
          para o e-mail informado.
        </p>
      ) : null}
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="confirmation-email">E-mail do cadastro</label>
        <input
          id="confirmation-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="voce@empresa.com.br"
        />
        <button disabled={pending || remaining > 0} aria-busy={pending}>
          {pending
            ? "Solicitando novo link…"
            : remaining > 0
              ? `Aguarde ${remaining}s para reenviar`
              : "Reenviar confirmação"}
        </button>
      </form>
    </details>
  );
}
