export default function BookingLoading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <div className="panel">
        <h1 style={{ fontSize: 28 }}>Preparando seu próximo horário…</h1>
        <p>Estamos consultando a agenda da empresa.</p>
      </div>
    </main>
  );
}
