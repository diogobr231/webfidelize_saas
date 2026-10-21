import Link from "next/link";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
export default function NotFound() {
  return (
    <main className="ui-state-page">
      <Brand />
      <span className="tag">404 · Vamos encontrar seu caminho</span>
      <h1>Página não encontrada</h1>
      <p>
        Confira o endereço ou volte ao início para continuar. Se você recebeu um
        link de agendamento, peça à empresa que confirme o endereço.
      </p>
      <div className="actions">
        <Link className="button" href="/">
          Voltar ao início <Icon name="arrow-right" size={16} />
        </Link>
        <Link className="button secondary" href="/entrar">
          Acessar minha conta
        </Link>
      </div>
    </main>
  );
}
