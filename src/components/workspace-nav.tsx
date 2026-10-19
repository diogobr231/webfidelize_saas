"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { canManage, type Role } from "@/lib/permissions";
import { Icon, type IconName } from "@/components/ui/icon";

const entries = [
  { path: "", label: "Visão geral", icon: "layout" },
  { path: "/agenda", label: "Agenda", icon: "calendar" },
  { path: "/customers", label: "Clientes", icon: "users" },
  { path: "/services", label: "Serviços", icon: "briefcase" },
  { path: "/professionals", label: "Profissionais", icon: "user" },
  { path: "/disponibilidade", label: "Horários e página", icon: "clock" },
  { path: "/ajuda", label: "Central de ajuda", icon: "help" },
] satisfies { path: string; label: string; icon: IconName }[];

export function WorkspaceNav({
  companyId,
  role,
}: {
  companyId: string;
  role: Role;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const base = `/painel/${companyId}`;
  return (
    <>
      <aside
        className="workspace-sidebar"
        data-open={open}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            open &&
            menuButton.current?.getClientRects().length
          ) {
            setOpen(false);
            menuButton.current.focus();
          }
        }}
      >
        <noscript>
          <style>{`
          @media (max-width: 850px) {
            .workspace-sidebar .workspace-mobile-menu { display: none !important; }
            .workspace-sidebar[data-open="false"] .workspace-nav-body { display: block !important; }
          }
        `}</style>
        </noscript>
        <button
          ref={menuButton}
          type="button"
          className="workspace-mobile-menu"
          aria-expanded={open}
          aria-controls="workspace-navigation"
          onClick={() => setOpen(!open)}
        >
          <Icon name="menu" size={18} />
          <span>Menu da empresa</span>
          <Icon name="chevron-down" size={16} />
        </button>
        <div id="workspace-navigation" className="workspace-nav-body">
          <p className="workspace-nav-caption">Seu espaço de trabalho</p>
          <nav aria-label="Menu da empresa" className="workspace-nav">
            {canManage(role) && (
              <Link
                href={`${base}/configuracao`}
                onClick={() => setOpen(false)}
                aria-current={
                  pathname === `${base}/configuracao` ? "page" : undefined
                }
              >
                <span className="workspace-nav-icon" aria-hidden="true">
                  <Icon name="check" size={18} />
                </span>
                Primeiros passos
              </Link>
            )}
            {entries.map((entry) => {
              const href = `${base}${entry.path}`;
              const active = pathname === href || pathname === `${href}/`;
              return (
                <Link
                  key={entry.path}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="workspace-nav-icon" aria-hidden="true">
                    <Icon name={entry.icon} size={18} />
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
                onClick={() => setOpen(false)}
                aria-current={
                  pathname === `${base}/equipe` ? "page" : undefined
                }
              >
                <span className="workspace-nav-icon" aria-hidden="true">
                  <Icon name="shield" size={18} />
                </span>
                Equipe e acessos
              </Link>
            )}
            {role === "OWNER" && (
              <Link
                href={`${base}/personalizacao`}
                onClick={() => setOpen(false)}
                aria-current={
                  pathname === `${base}/personalizacao` ? "page" : undefined
                }
              >
                <Icon name="settings" size={18} />
                Personalização
              </Link>
            )}
            {canManage(role) && (
              <Link
                href={`${base}/assinatura`}
                onClick={() => setOpen(false)}
                aria-current={
                  pathname === `${base}/assinatura` ? "page" : undefined
                }
              >
                <Icon name="briefcase" size={18} />
                Planos e assinatura
              </Link>
            )}
          </nav>
          <div className="workspace-nav-footer">
            <Link href="/painel?empresas=1" onClick={() => setOpen(false)}>
              <Icon name="building" size={16} />
              Trocar empresa
            </Link>
            <a
              href="https://wa.me/5518997695445"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="help" size={16} />
              Falar com o suporte
              <Icon name="arrow-up-right" size={14} />
            </a>
            <p>
              Uma rotina mais leve,
              <br />
              um atendimento de cada vez.
            </p>
          </div>
        </div>
      </aside>
      <nav className="workspace-bottom-nav" aria-label="Atalhos no celular">
        {[
          {
            href: base,
            label: role === "EMPLOYEE" ? "Meu dia" : "Visão geral",
            icon: "layout" as const,
          },
          {
            href: `${base}/agenda`,
            label: "Agenda",
            icon: "calendar" as const,
          },
          {
            href: `${base}/customers`,
            label: "Clientes",
            icon: "users" as const,
          },
          { href: `${base}/ajuda`, label: "Ajuda", icon: "help" as const },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
