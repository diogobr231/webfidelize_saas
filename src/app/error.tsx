"use client";
import Link from "next/link";
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
        <Link className="button secondary" href="/">
          Voltar ao início
        </Link>
        <a
          className="button secondary"
          href="https://wa.me/5518997695445"
          target="_blank"
          rel="noopener noreferrer"
        >
          Falar com o suporte <Icon name="phone" size={16} />
        </a>
      </div>
    </main>
  );
}
