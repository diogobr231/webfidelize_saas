"use client";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="ui-state-page">
      <Brand />
      <h1>Não foi possível concluir.</h1>
      <p>
        Tente novamente. Se o problema continuar, entre em contato com o
        suporte.
      </p>
      <div className="actions">
        <button onClick={reset}>
          <Icon name="arrow-right" size={16} />
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
