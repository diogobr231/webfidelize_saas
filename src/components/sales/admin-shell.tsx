import type { ReactNode } from "react";
import Link from "next/link";
import { AdminNavigation } from "@/components/admin/navigation";
import { Icon } from "@/components/ui/icon";

export function AdminSalesShell({
  children,
  current = "leads",
}: {
  children: ReactNode;
  current?: "leads" | "offers";
}) {
  return (
    <main className="admin-shell sales-admin-shell">
      <a className="sales-skip" href="#comercial-conteudo">
        Pular para o conteúdo
      </a>
      <AdminNavigation current="sales" />
      <div
        className="admin-content sales-admin-content"
        id="comercial-conteudo"
      >
        <nav className="sales-subnav" aria-label="Central comercial">
          <Link
            href="/admin/comercial"
            aria-current={current === "leads" ? "page" : undefined}
          >
            <Icon name="layout" size={17} /> Funil comercial
          </Link>
          <Link
            href="/admin/comercial/ofertas"
            aria-current={current === "offers" ? "page" : undefined}
          >
            <Icon name="briefcase" size={17} /> Ofertas
          </Link>
        </nav>
        {children}
      </div>
    </main>
  );
}

export function SalesPagination({
  page,
  count,
  pageSize,
  href,
  label = "Páginas de contatos",
}: {
  page: number;
  count: number;
  pageSize: number;
  href: (page: number) => string;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="sales-pagination" aria-label={label}>
      {page > 1 ? (
        <Link className="button secondary" href={href(page - 1)}>
          <Icon name="chevron-left" size={16} /> Anterior
        </Link>
      ) : (
        <span />
      )}
      <span>
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <Link className="button secondary" href={href(page + 1)}>
          Próxima <Icon name="chevron-right" size={16} />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
