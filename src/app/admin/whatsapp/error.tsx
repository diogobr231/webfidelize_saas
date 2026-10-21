"use client";
import Link from "next/link";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="admin-shell">
      <section className="admin-content" role="alert">
        <h1>Não foi possível carregar as cotas</h1>
        <p>Os limites salvos continuam preservados.</p>
        <div className="actions">
          <button onClick={reset}>Tentar novamente</button>
          <Link href="/admin" className="button secondary">
            Voltar à administração
          </Link>
        </div>
      </section>
    </main>
  );
}
