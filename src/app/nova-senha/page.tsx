import { updatePassword } from "@/app/auth/actions";
import { requireUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";

export default async function NewPassword() {
  await requireUser();
  return (
    <AuthShell
      eyebrow="SEU ACESSO, RENOVADO"
      title="Definir nova senha"
      description="Escolha uma senha com pelo menos 8 caracteres para continuar usando sua conta."
    >
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
        <PendingButton pendingLabel="Salvando senha…">
          Salvar senha <Icon name="arrow-right" />
        </PendingButton>
      </form>
    </AuthShell>
  );
}
