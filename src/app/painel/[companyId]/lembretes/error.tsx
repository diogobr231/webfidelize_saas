"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <section className="panel" role="alert">
      <h2>Não foi possível abrir os lembretes</h2>
      <p>As preferências salvas continuam preservadas.</p>
      <button onClick={reset}>Tentar novamente</button>
    </section>
  );
}
