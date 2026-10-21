import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, configured } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";
import { z } from "zod";
export const dynamic = "force-dynamic";
async function accept(form: FormData) {
  "use server";
  const token = String(form.get("token"));
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const destination = `/convite/${token}`;
  const login = `/entrar?next=${encodeURIComponent(destination)}`;
  if (!configured()) redirect(`${login}&erro=configuracao`);
  const db = await createClient();
  const {
    data: { user },
    error: sessionError,
  } = await db.auth.getUser();
  if (sessionError || !user) redirect(login);
  const { data, error } = await db.rpc("accept_invitation", { token });
  if (error) {
    const code = error.message.includes("member limit")
      ? "capacidade"
      : error.message.includes("subscription blocked")
        ? "assinatura"
        : "aceite";
    redirect(`/convite/${token}?erro=${code}`);
  }
  if (!z.uuid().safeParse(data).success)
    redirect(`/convite/${token}?erro=aceite`);
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
  const destination = encodeURIComponent(`/convite/${token}`);
  const db = configured() ? await createClient() : null;
  const session = db ? await db.auth.getUser() : null;
  const user = session?.error ? null : session?.data.user;
  return (
    <AuthShell
      eyebrow="FAÇA PARTE DA EQUIPE"
      title="Você foi convidado."
      description="Entre com o e-mail que recebeu o convite e confirme sua participação. O convite é de uso único e válido por 48 horas."
    >
      {p.erro && (
        <p className="notice error" role="alert">
          {p.erro === "capacidade"
            ? "A empresa atingiu o limite de colaboradores. Peça ao proprietário para revisar os acessos ou o plano antes de tentar novamente."
            : p.erro === "assinatura"
              ? "A assinatura da empresa precisa ser regularizada para aceitar este convite. Fale com o proprietário."
              : "Não foi possível aceitar. O convite pode ter expirado, sido cancelado, renovado ou utilizado. Confira também se está usando o mesmo e-mail convidado e se ele foi confirmado."}
        </p>
      )}
      <div className="auth-invitation-links">
        <Link href={`/entrar?next=${destination}`}>
          {user ? "Entrar com outra conta" : "Entrar"}
        </Link>
        <Link href={`/cadastro?next=${destination}`}>Criar conta</Link>
      </div>
      {user ? (
        <p className="notice">
          Conta atual: <strong>{user.email}</strong>.{" "}
          {user.email_confirmed_at
            ? "Confirme abaixo para participar da empresa."
            : "Confirme seu e-mail antes de aceitar o convite."}
        </p>
      ) : (
        <p>
          Depois de entrar ou confirmar o cadastro, você retornará a este
          convite. Não é necessário criar uma empresa para participar da equipe.
        </p>
      )}
      <form action={accept}>
        <input type="hidden" name="token" value={token} />
        <PendingButton pendingLabel="Confirmando participação…">
          Aceitar convite <Icon name="arrow-right" />
        </PendingButton>
      </form>
    </AuthShell>
  );
}
