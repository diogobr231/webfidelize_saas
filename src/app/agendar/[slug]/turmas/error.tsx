"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="ui-state-page">
      <section className="panel">
        <h1>Vamos tentar novamente?</h1>
        <p role="alert">
          Não foi possível carregar as atividades agora. Nenhuma inscrição é
          confirmada sem a resposta da empresa.
        </p>
        <button onClick={reset}>Atualizar atividades</button>
      </section>
    </main>
  );
}
