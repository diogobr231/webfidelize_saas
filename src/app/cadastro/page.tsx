import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { PendingButton } from "@/components/pending-button";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/ui/icon";

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const p = await searchParams;
  return (
    <AuthShell
      eyebrow="SEU PRÓXIMO PASSO COMEÇA AQUI"
      title="Um novo começo para seu negócio."
      description="Crie sua conta e confirme seu e-mail. Depois, vamos guiar você pelo cadastro da empresa, dos serviços e dos profissionais."
      footer={
        <>
          Já tem uma conta? <Link href="/entrar">Entrar na Web Fidelize</Link>
        </>
      }
    >
      <div className="auth-trial-note">
        <Icon name="check" size={17} />
        <span>
          7 dias grátis, sem cartão. Seu teste começa quando você cria a
          empresa.
        </span>
      </div>
      {p.erro && (
        <p className="notice error" role="alert">
          Não foi possível cadastrar. Confira os campos e a configuração do
          ambiente.
        </p>
      )}
      <form action={signup}>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="voce@empresa.com.br"
        />
        <label htmlFor="password">Senha com pelo menos 8 caracteres</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          maxLength={128}
          required
          autoComplete="new-password"
          placeholder="Crie sua senha"
        />
        <PendingButton pendingLabel="Criando sua conta…">
          Criar minha conta <Icon name="arrow-right" />
        </PendingButton>
      </form>
    </AuthShell>
  );
}
