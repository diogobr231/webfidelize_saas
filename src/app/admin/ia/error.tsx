"use client";
import Link from "next/link";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="admin-content">
      <section className="panel">
        <h1>Não foi possível carregar a Central IA.</h1>
        <p role="alert">Tente novamente para consultar os registros salvos.</p>
        <button onClick={reset}>Tentar novamente</button>{" "}
        <Link className="button secondary" href="/admin">
          Voltar ao admin
        </Link>
      </section>
    </main>
  );
}
