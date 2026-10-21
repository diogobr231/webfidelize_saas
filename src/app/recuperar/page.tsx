import Link from "next/link";
import { recover } from "@/app/auth/actions";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";
import { authErrorMessage } from "@/lib/auth-flow";

export default async function Recover({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string; erro?: string }>;
}) {
  const p = await searchParams;
  return (
    <AuthShell
      eyebrow="VAMOS RECONECTAR VOCÊ"
      title="Recuperar acesso"
      description="Enviaremos um link se houver uma conta para este e-mail."
      footer={<Link href="/entrar">Voltar ao login</Link>}
    >
      {p.aviso && (
        <p className="notice" role="status">
          Se a conta existir, você receberá as instruções por e-mail. Confira a
          pasta de spam e aguarde alguns minutos antes de solicitar outro link.
        </p>
      )}
      {p.erro && (
        <p className="notice error" role="alert">
          {authErrorMessage(p.erro)}
        </p>
      )}
      <form action={recover}>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="O e-mail da sua conta"
        />
        <PendingButton pendingLabel="Enviando instruções…">
          Enviar instruções <Icon name="arrow-right" />
        </PendingButton>
      </form>
    </AuthShell>
  );
}
