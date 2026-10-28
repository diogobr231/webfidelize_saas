import "./confirmation.css";
export default function Loading() {
  return (
    <main className="confirmation-page">
      <section
        className="confirmation-card"
        aria-busy="true"
        aria-live="polite"
      >
        <h1>Consultando seu agendamento…</h1>
        <p>Estamos verificando o horário com a empresa.</p>
      </section>
    </main>
  );
}
