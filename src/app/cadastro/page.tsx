import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { PendingButton } from "@/components/pending-button";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/ui/icon";
import {
  authDestination,
  authErrorMessage,
  authPageUrl,
} from "@/lib/auth-flow";

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; next?: string }>;
}) {
  const p = await searchParams;
  const next = authDestination(p.next);
  return (
    <AuthShell
      eyebrow="SEU PRÓXIMO PASSO COMEÇA AQUI"
      title="Um novo começo para seu negócio."
      description={
        next === "/painel"
          ? "Crie sua conta, confirme seu e-mail e cadastre a empresa. A configuração dos serviços e profissionais será liberada após a ativação do teste."
          : "Crie sua conta usando o e-mail que recebeu o convite. Após confirmar o cadastro, você poderá aceitar sua participação na empresa."
      }
      footer={
        <>
          Já tem uma conta?{" "}
          <Link href={authPageUrl("/entrar", { next })}>
            Entrar na Web Fidelize
          </Link>
        </>
      }
    >
      <div className="auth-trial-note">
        <Icon name="check" size={17} />
        <span>
          {next === "/painel"
            ? "O teste de 7 dias exige cartão cadastrado e autorizado no Mercado Pago. Primeira mensalidade somente após o teste. A ativação está em preparação; criar sua conta agora não inicia o período nem gera cobrança."
            : "Você revisará o convite antes de participar. Criar uma conta não aceita o convite automaticamente."}
        </span>
      </div>
      {p.erro && (
        <p className="notice error" role="alert">
          {authErrorMessage(p.erro)}
        </p>
      )}
      <form action={signup}>
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
