"use client";
import "./confirmation.css";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="confirmation-page">
      <section className="confirmation-card" role="alert">
        <h1>Não conseguimos abrir o agendamento</h1>
        <p>Tente novamente em alguns instantes.</p>
        <button onClick={reset}>Tentar novamente</button>
      </section>
    </main>
  );
}
