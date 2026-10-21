import { updatePassword } from "@/app/auth/actions";
import { requireRecoverySession } from "@/lib/auth-recovery";
import { authErrorMessage } from "@/lib/auth-flow";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";

export default async function NewPassword({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  await requireRecoverySession();
  const params = await searchParams;
  return (
    <AuthShell
      eyebrow="SEU ACESSO, RENOVADO"
      title="Definir nova senha"
      description="Escolha uma senha de 8 a 128 caracteres. Por segurança, conclua esta etapa até 15 minutos após confirmar o link de recuperação."
    >
      {params.erro ? (
        <p className="notice error" role="alert">
          {authErrorMessage(params.erro)}
        </p>
      ) : null}
      <form action={updatePassword}>
        <label htmlFor="password">Nova senha</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          required
          placeholder="Crie sua nova senha"
        />
        <label htmlFor="password-confirmation">Repita a nova senha</label>
        <input
          id="password-confirmation"
          name="password_confirmation"
          type="password"
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          required
          placeholder="Repita a mesma senha"
        />
        <PendingButton pendingLabel="Salvando senha…">
          Salvar senha <Icon name="arrow-right" />
        </PendingButton>
      </form>
    </AuthShell>
  );
}
