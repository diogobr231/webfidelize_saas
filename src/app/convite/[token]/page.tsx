import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";
export const dynamic = "force-dynamic";
async function accept(form: FormData) {
  "use server";
  const { db } = await requireUser();
  const token = String(form.get("token"));
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const { data, error } = await db.rpc("accept_invitation", { token });
  if (error) redirect(`/convite/${token}?erro=aceite`);
  redirect(`/painel/${data}`);
}
export default async function Invitation({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const p = await searchParams;
  return (
    <AuthShell
      eyebrow="FAÇA PARTE DA EQUIPE"
      title="Você foi convidado."
      description="Entre com o e-mail que recebeu o convite e confirme sua participação. O convite é de uso único e válido por 48 horas."
    >
      {p.erro && (
        <p className="notice error" role="alert">
          Convite expirado, já utilizado, e-mail diferente ou limite do plano
          atingido.
        </p>
      )}
      <div className="auth-invitation-links">
        <Link href="/entrar">Entrar</Link>
        <Link href="/cadastro">Criar conta</Link>
      </div>
      <form action={accept}>
        <input type="hidden" name="token" value={token} />
        <PendingButton pendingLabel="Confirmando participação…">
          Aceitar convite <Icon name="arrow-right" />
        </PendingButton>
      </form>
    </AuthShell>
  );
}
