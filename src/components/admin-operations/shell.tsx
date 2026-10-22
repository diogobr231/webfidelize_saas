import Link from "next/link";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";

export function OperationsShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="admin-shell ops-shell">
      <nav className="admin-topbar" aria-label="Administração da plataforma">
        <Brand href="/admin" />
        <div className="admin-topbar-actions">
          <Link className="button secondary" href="/admin">
            Visão geral
          </Link>
          <Link className="button secondary" href="/admin/comercial">
            Central comercial
          </Link>
          <Link className="button secondary" href="/admin/ajuda">
            Atendimento
          </Link>
          <span className="admin-access">
            <Icon name="shield" size={14} /> SUPER_ADMIN
          </span>
        </div>
      </nav>
      <div className="admin-content">{children}</div>
    </main>
  );
}
