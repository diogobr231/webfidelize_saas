import Link from "next/link";
import { logout } from "@/app/auth/actions";
import { Brand } from "@/components/ui/brand";
import { Icon, type IconName } from "@/components/ui/icon";

const sections = {
  overview: { label: "Visão geral", href: "/admin", icon: "layout" },
  spaces: { label: "Espaços", href: "/admin/espacos", icon: "building" },
  sales: { label: "Comercial", href: "/admin/comercial", icon: "briefcase" },
  tasks: { label: "Tarefas", href: "/admin/automacoes", icon: "check" },
  support: { label: "Atendimento", href: "/admin/ajuda", icon: "help" },
  marketing: { label: "Marketing", href: "/admin/marketing", icon: "sparkles" },
  social: {
    label: "Serviços dos clientes",
    href: "/admin/redes",
    icon: "briefcase",
  },
  ai: { label: "Central IA", href: "/admin/ia", icon: "sparkles" },
  whatsapp: { label: "WhatsApp", href: "/admin/whatsapp", icon: "phone" },
  integrations: {
    label: "Integrações",
    href: "/admin/integracoes",
    icon: "link",
  },
} as const satisfies Record<
  string,
  { label: string; href: string; icon: IconName }
>;

export type AdminSection = keyof typeof sections;
const groups: { label: string; items: AdminSection[] }[] = [
  {
    label: "Operação",
    items: ["overview", "spaces", "social", "sales", "tasks", "support"],
  },
  { label: "Crescimento", items: ["marketing", "ai"] },
  { label: "Configuração", items: ["whatsapp", "integrations"] },
];

function NavigationGroups({ current }: { current: AdminSection }) {
  return (
    <div className="admin-navigation-groups">
      {groups.map((group) => (
        <div className="admin-navigation-group" key={group.label}>
          <span className="admin-navigation-label">{group.label}</span>
          <div className="admin-navigation-links">
            {group.items.map((id) => {
              const item = sections[id];
              return (
                <Link
                  key={id}
                  href={item.href}
                  aria-current={current === id ? "page" : undefined}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Server-rendered navigation: no session details or permissions go to a client bundle. */
export function AdminNavigation({ current }: { current: AdminSection }) {
  const item = sections[current];
  return (
    <header className="admin-navigation">
      <div className="admin-topbar">
        <Brand href="/admin" />
        <div className="admin-topbar-actions">
          <span className="admin-access">
            <Icon name="shield" size={14} /> SUPER_ADMIN
          </span>
          <Link
            className="button secondary admin-spaces-link"
            href="/admin/espacos"
          >
            <Icon name="building" size={16} /> Ver espaços
          </Link>
          <form action={logout}>
            <button className="secondary admin-logout">
              <Icon name="logout" size={16} /> Sair
            </button>
          </form>
        </div>
      </div>
      <nav
        className="admin-navigation-desktop"
        aria-label="Guias da administração"
      >
        <NavigationGroups current={current} />
      </nav>
      <details className="admin-navigation-mobile">
        <summary>
          <span>
            <Icon name="menu" size={18} /> Guias do admin
          </span>
          <span>
            {item.label} <Icon name="chevron-down" size={16} />
          </span>
        </summary>
        <nav aria-label="Guias da administração no celular">
          <NavigationGroups current={current} />
        </nav>
      </details>
      <nav className="admin-breadcrumb" aria-label="Você está aqui">
        <ol>
          <li>
            {current === "overview" ? (
              <span>Administração</span>
            ) : (
              <Link href="/admin">Administração</Link>
            )}
          </li>
          {current !== "overview" && (
            <li aria-current="page">
              <Icon name="chevron-right" size={13} /> {item.label}
            </li>
          )}
        </ol>
      </nav>
    </header>
  );
}
