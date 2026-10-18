import "@/components/onboarding/onboarding.css";

export default function Loading() {
  return (
    <main className="onb-loading" aria-busy="true">
      <div className="onb-loading-card">
        <span className="onb-loading-indicator" aria-hidden="true" />
        <h1>Preparando seu começo…</h1>
        <p role="status">Estamos consultando os dados da sua conta.</p>
      </div>
    </main>
  );
}
