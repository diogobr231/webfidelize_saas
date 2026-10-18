"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/permissions";

const entries = [
  { path: "", label: "Meu dia", icon: "◈" },
  { path: "/agenda", label: "Agenda", icon: "▦" },
  { path: "/customers", label: "Clientes", icon: "◎" },
  { path: "/services", label: "Serviços", icon: "◇" },
  { path: "/professionals", label: "Profissionais", icon: "♧" },
  { path: "/disponibilidade", label: "Horários e página", icon: "◷" },
];

export function WorkspaceNav({
  companyId,
  role,
}: {
  companyId: string;
  role: Role;
}) {
  const pathname = usePathname();
  const base = `/painel/${companyId}`;
  return (
    <aside className="workspace-sidebar">
      <p className="workspace-nav-caption">Seu espaço de trabalho</p>
      <nav aria-label="Menu da empresa" className="workspace-nav">
        {entries.map((entry) => {
          const href = `${base}${entry.path}`;
          const active = pathname === href || pathname === `${href}/`;
          return (
            <Link
              key={entry.path}
              href={href}
              aria-current={active ? "page" : undefined}
            >
              <span className="workspace-nav-icon" aria-hidden="true">
                {entry.icon}
              </span>
              {role === "EMPLOYEE" && entry.path === "/disponibilidade"
                ? "Meus horários"
                : entry.label}
            </Link>
          );
        })}
        {role === "OWNER" && (
          <Link
            href={`${base}/equipe`}
            aria-current={pathname === `${base}/equipe` ? "page" : undefined}
          >
            <span className="workspace-nav-icon" aria-hidden="true">
              ⊕
            </span>
            Equipe e acessos
          </Link>
        )}
      </nav>
      <div className="workspace-nav-footer">
        <Link href="/painel?empresas=1">Trocar empresa ↗</Link>
        <a href="https://wa.me/5518997695445" target="_blank" rel="noreferrer">
          Falar com o suporte ↗
        </a>
        <p>
          Uma rotina mais leve,
          <br />
          um atendimento de cada vez.
        </p>
      </div>
    </aside>
  );
}
