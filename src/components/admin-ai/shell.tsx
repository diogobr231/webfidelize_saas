import Link from "next/link";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
export function AdminAiShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="admin-shell ai-shell">
      <nav className="admin-topbar" aria-label="Central IA administrativa">
        <Brand href="/admin" />
        <div className="admin-topbar-actions">
          <Link className="button secondary" href="/admin">
            Visão geral
          </Link>
          <Link className="button secondary" href="/admin/comercial">
            Funil comercial
          </Link>
          <Link className="button secondary" href="/admin/automacoes">
            Automações
          </Link>
          <Link className="button secondary" href="/admin/ajuda">
            Atendimento
          </Link>
          <span className="admin-access">
            <Icon name="shield" size={14} /> SUPER_ADMIN
          </span>
        </div>
      </nav>
      <div className="admin-content">
        <nav className="ai-subnav" aria-label="Seções da Central IA">
          <a href="#analises">Análises e revisão</a>
          <a href="#solicitar">Preparar análise</a>
          <a href="#configuracao">Limites e configuração</a>
          <a href="#historico">Execuções</a>
        </nav>
        {children}
      </div>
    </main>
  );
}
