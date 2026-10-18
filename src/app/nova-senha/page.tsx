import { updatePassword } from "@/app/auth/actions";
import { requireUser } from "@/lib/auth";
export default async function NewPassword() {
  await requireUser();
  return (
    <main className="auth panel">
      <h1>Definir nova senha</h1>
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
        />
        <button>Salvar senha</button>
      </form>
    </main>
  );
}
