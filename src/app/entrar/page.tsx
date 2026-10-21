import Link from "next/link";
import { login } from "@/app/auth/actions";
import { configured } from "@/lib/supabase/server";
import { niches } from "@/lib/catalog";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";
import {
  authDestination,
  authErrorMessage,
  authPageUrl,
} from "@/lib/auth-flow";
import { ResendConfirmationForm } from "@/app/auth/resend-form";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = authDestination(params.next);
  return (
    <AuthShell
      eyebrow="BEM-VINDO DE VOLTA"
      title="Seu negócio começa por aqui."
      description="Acesse sua conta e continue de onde parou."
      footer={
        <>
          Ainda não tem uma conta?{" "}
          <Link href={authPageUrl("/cadastro", { next })}>
            Comece seu teste grátis
          </Link>
        </>
      }
    >
      {!configured() && (
        <div className="notice" role="status">
          Ambiente em implantação. A conexão segura com o Supabase ainda precisa
          ser configurada.
        </div>
      )}
      {params.erro && (
        <div role="alert" className="notice error">
          {authErrorMessage(params.erro)}
        </div>
      )}
      {params.aviso && (
        <div role="status" className="notice">
          {params.aviso === "senha-atualizada"
            ? "Senha atualizada. Entre com sua nova senha."
            : "Se o cadastro precisar de confirmação, você receberá um link por e-mail. Se já tem uma conta, entre com sua senha."}
        </div>
      )}
      <form action={login}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="voce@empresa.com.br"
        />
        <div className="auth-password-label">
          <label htmlFor="password">Senha</label>
          <Link href="/recuperar">Esqueceu sua senha?</Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          maxLength={128}
          required
          autoComplete="current-password"
          placeholder="Sua senha de acesso"
        />
        <PendingButton pendingLabel="Entrando…">
          Entrar na minha conta <Icon name="arrow-right" />
        </PendingButton>
      </form>
      <ResendConfirmationForm next={next} />
      <details className="auth-segments">
        <summary>
          Uma entrada para cada rotina <Icon name="chevron-right" size={15} />
        </summary>
        <div className="auth-segment-links">
          {niches.map((n) => (
            <Link
              key={n.slug}
              href={`/entrar/${n.slug}${next === "/painel" ? "" : `?${new URLSearchParams({ next })}`}`}
            >
              {n.name}
            </Link>
          ))}
        </div>
      </details>
    </AuthShell>
  );
}
