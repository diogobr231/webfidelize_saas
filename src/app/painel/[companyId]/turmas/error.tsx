"use client";
import Link from "next/link";
export default function ClassesError({ reset }: { reset: () => void }) {
  return (
    <section className="panel">
      <h1>As turmas estão temporariamente indisponíveis</h1>
      <p role="alert">
        Não conseguimos consultar os dados. Tente novamente em instantes.
      </p>
      <button onClick={reset}>Tentar novamente</button>
      <Link href="/painel" className="button secondary">
        Voltar ao painel
      </Link>
    </section>
  );
}
