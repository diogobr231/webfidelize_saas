import Link from "next/link";
import { login } from "@/app/auth/actions";
import { configured } from "@/lib/supabase/server";
import { niches } from "@/lib/catalog";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      eyebrow="BEM-VINDO DE VOLTA"
      title="Seu negócio começa por aqui."
      description="Acesse sua conta e continue de onde parou."
      footer={
        <>
          Ainda não tem uma conta?{" "}
          <Link href="/cadastro">Comece seu teste grátis</Link>
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
          {params.erro === "configuracao"
            ? "A autenticação ainda não foi configurada."
            : "Não foi possível entrar. Confira suas credenciais ou solicite um novo link."}
        </div>
      )}
      {params.aviso && (
        <div role="status" className="notice">
          Verifique seu e-mail para confirmar o cadastro antes de entrar.
        </div>
      )}
      <form action={login}>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          required
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
      <details className="auth-segments">
        <summary>
          Uma entrada para cada rotina <Icon name="chevron-right" size={15} />
        </summary>
        <div className="auth-segment-links">
          {niches.map((n) => (
            <Link key={n.slug} href={`/entrar/${n.slug}`}>
              {n.name}
            </Link>
          ))}
        </div>
      </details>
    </AuthShell>
  );
}
