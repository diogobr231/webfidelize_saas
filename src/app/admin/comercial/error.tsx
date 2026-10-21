"use client";
import Link from "next/link";

export default function SalesError({ reset }: { reset: () => void }) {
  return (
    <main className="admin-shell">
      <section className="admin-content sales-error" role="alert">
        <h1>Não foi possível carregar a central comercial</h1>
        <p>Tente novamente. As informações salvas continuam preservadas.</p>
        <div className="actions">
          <button onClick={reset}>Tentar novamente</button>
          <Link className="button secondary" href="/admin">
            Voltar à administração
          </Link>
        </div>
      </section>
    </main>
  );
}
