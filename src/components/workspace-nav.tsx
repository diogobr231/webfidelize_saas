"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { canManage, type Role } from "@/lib/permissions";
import { Icon, type IconName } from "@/components/ui/icon";

const entries = [
  { path: "", label: "Visão geral", icon: "layout" },
  { path: "/meu-dia", label: "Meu dia", icon: "user" },
  { path: "/agenda", label: "Agenda", icon: "calendar" },
  { path: "/turmas", label: "Turmas e vagas", icon: "users" },
  { path: "/customers", label: "Clientes", icon: "users" },
  { path: "/services", label: "Serviços", icon: "briefcase" },
  { path: "/professionals", label: "Profissionais", icon: "user" },
  { path: "/disponibilidade", label: "Horários e página", icon: "clock" },
  { path: "/ajuda", label: "Central de ajuda", icon: "help" },
] satisfies { path: string; label: string; icon: IconName }[];

export function WorkspaceNav({
  companyId,
  role,
  niche,
}: {
  companyId: string;
  role: Role;
  niche: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const base = `/painel/${companyId}`;
  const navigation: { path: string; label: string; icon: IconName }[] = [
    ...(canManage(role)
      ? [
          {
            path: "/configuracao",
            label: "Primeiros passos",
            icon: "check" as const,
          },
        ]
      : []),
    ...entries.map((entry) => ({
      ...entry,
      label:
        role === "EMPLOYEE" && entry.path === "/disponibilidade"
          ? "Meus horários"
          : entry.label,
    })),
    ...(canManage(role) &&
    [
      "restaurante",
      "fornecedores",
      "logistica",
      "pet-shop",
      "escritorio",
      "salao",
      "academia",
    ].includes(niche)
      ? [
          {
            path: "/operacoes",
            label: "Operações do negócio",
            icon: "layout" as const,
          },
        ]
      : []),
    ...(role === "OWNER"
      ? [
          {
            path: "/equipe",
            label: "Equipe e acessos",
            icon: "shield" as const,
          },
          {
            path: "/personalizacao",
            label: "Personalização",
            icon: "settings" as const,
          },
        ]
      : []),
    ...(canManage(role)
      ? [
          {
            path: "/equipe/indicadores",
            label: "Indicadores da equipe",
            icon: "users" as const,
          },
          {
            path: "/lembretes",
            label: "Lembretes WhatsApp",
            icon: "phone" as const,
          },
          {
            path: "/assinatura",
            label: "Planos e assinatura",
            icon: "briefcase" as const,
          },
        ]
      : []),
  ];
  const currentEntry = navigation
    .toSorted((a, b) => b.path.length - a.path.length)
    .find((entry) => {
      const href = `${base}${entry.path}`;
      return (
        pathname === href ||
        pathname === `${href}/` ||
        (href !== base && pathname.startsWith(`${href}/`))
      );
    });
  function currentLocation(href: string) {
    // Only the most specific item is current within this navigation set.
    if (!currentEntry || href !== `${base}${currentEntry.path}`)
      return undefined;
    return pathname === href || pathname === `${href}/`
      ? ("page" as const)
      : ("location" as const);
  }
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
          aria-label={`${open ? "Fechar" : "Abrir"} menu da empresa${currentEntry ? `. Seção atual: ${currentEntry.label}` : ""}`}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={currentEntry?.icon ?? "menu"} size={18} />
          <span className="workspace-mobile-context">
            <small>Seu espaço de trabalho</small>
            <strong>{currentEntry?.label ?? "Menu da empresa"}</strong>
          </span>
          <span className="workspace-mobile-menu-label">Menu</span>
          <Icon name="chevron-down" size={16} />
        </button>
        <div id="workspace-navigation" className="workspace-nav-body">
          <p className="workspace-nav-caption">Seu espaço de trabalho</p>
          <nav aria-label="Menu da empresa" className="workspace-nav">
            {navigation.map((entry) => {
              const href = `${base}${entry.path}`;
              return (
                <Link
                  key={entry.path}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={currentLocation(href)}
                >
                  <span className="workspace-nav-icon" aria-hidden="true">
                    <Icon name={entry.icon} size={18} />
                  </span>
                  {entry.label}
                </Link>
              );
            })}
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
            href: role === "EMPLOYEE" ? `${base}/meu-dia` : base,
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
            aria-current={currentLocation(item.href)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
