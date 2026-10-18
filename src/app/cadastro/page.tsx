import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { PendingButton } from "@/components/pending-button";
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const p = await searchParams;
  return (
    <main className="auth">
      <Link className="brand" href="/">
        web<span>fidelize</span>
      </Link>
      <h1>Um novo começo para seu negócio.</h1>
      <p>
        Crie sua conta e confirme seu e-mail. Depois, vamos guiar você pelo
        cadastro da empresa, dos serviços e dos profissionais.
      </p>
      <p>
        Seu teste gratuito de sete dias começa quando você cria a empresa. Não
        precisa de cartão.
      </p>
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
        />
        <PendingButton pendingLabel="Criando sua conta…">
          Criar minha conta →
        </PendingButton>
      </form>
      <p>
        <Link href="/entrar">Já tenho uma conta</Link>
      </p>
    </main>
  );
}
