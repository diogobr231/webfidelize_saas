import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import {
  authErrorMessage,
  authDestinationFromEmailRedirect,
  authPageUrl,
  parseEmailConfirmation,
} from "@/lib/auth-flow";
import { getAuthOrigin } from "@/lib/auth-origin";
import { confirmEmail } from "../actions";

export const metadata: Metadata = {
  title: "Confirmar acesso | Web Fidelize",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConfirmEmail({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    next?: string;
    redirect_to?: string;
  }>;
}) {
  const params = await searchParams;
  let next = params.next;
  let configured = true;
  try {
    const origin = getAuthOrigin();
    if (params.redirect_to !== undefined)
      next = authDestinationFromEmailRedirect(params.redirect_to, origin);
  } catch {
    configured = false;
  }
  const confirmation = configured
    ? parseEmailConfirmation({ ...params, next })
    : null;
  const recovery = confirmation?.type === "recovery";
  return (
    <AuthShell
      eyebrow="CONFIRMAÇÃO SEGURA"
      title={
        recovery
          ? "Vamos recuperar seu acesso."
          : "Confirme seu e-mail para continuar."
      }
      description={
        recovery
          ? "Toque no botão abaixo para escolher sua nova senha."
          : "Use o botão abaixo para confirmar o e-mail e acessar sua conta."
      }
      footer={
        <Link href={authPageUrl("/entrar", { next: confirmation?.next })}>
          Voltar ao login
        </Link>
      }
    >
      {confirmation ? (
        <>
          <p className="notice">
            Continue apenas se você solicitou este e-mail. Abrir esta página
            ainda não confirma o acesso.
          </p>
          <form action={confirmEmail}>
            <input
              type="hidden"
              name="token_hash"
              value={confirmation.token_hash}
            />
            <input type="hidden" name="type" value={confirmation.type} />
            <input type="hidden" name="next" value={confirmation.next} />
            <PendingButton pendingLabel="Verificando link…">
              {recovery ? "Continuar e definir senha" : "Confirmar e acessar"}
            </PendingButton>
          </form>
        </>
      ) : (
        <>
          <p role="alert" className="notice error">
            {authErrorMessage(configured ? "link" : "configuracao")}
          </p>
          <div className="auth-invitation-links">
            <Link href="/entrar">Reenviar confirmação</Link>
            <Link href="/recuperar">Recuperar senha</Link>
          </div>
        </>
      )}
    </AuthShell>
  );
}
