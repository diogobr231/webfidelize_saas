"use client";
import Link from "next/link";
export default function OperationsError({ reset }: { reset: () => void }) {
  return (
    <main className="admin-content">
      <section className="panel">
        <h1>Não foi possível abrir a central.</h1>
        <p role="alert">
          Tente novamente. As configurações já salvas continuam preservadas.
        </p>
        <div className="ops-actions">
          <button onClick={reset}>Tentar novamente</button>
          <Link className="button secondary" href="/admin">
            Voltar ao admin
          </Link>
        </div>
      </section>
    </main>
  );
}
