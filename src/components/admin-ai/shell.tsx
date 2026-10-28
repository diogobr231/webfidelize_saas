import { AdminNavigation } from "@/components/admin/navigation";
import { Icon } from "@/components/ui/icon";
export function AdminAiShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="admin-shell ai-shell">
      <AdminNavigation current="ai" />
      <div className="admin-content">
        <nav className="ai-subnav" aria-label="Seções da Central IA">
          <a href="#analises">
            <Icon name="check" size={16} /> Revisão
          </a>
          <a href="#solicitar">
            <Icon name="plus" size={16} /> Nova análise
          </a>
          <a href="#configuracao">
            <Icon name="settings" size={16} /> Limites
          </a>
          <a href="#historico">
            <Icon name="clock" size={16} /> Histórico
          </a>
        </nav>
        {children}
      </div>
    </main>
  );
}
