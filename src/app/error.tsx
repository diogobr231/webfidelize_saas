"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1>Não foi possível concluir.</h1>
      <p>
        Tente novamente. Se o problema continuar, entre em contato com o
        suporte.
      </p>
      <button onClick={reset}>Tentar novamente</button>
    </main>
  );
}
