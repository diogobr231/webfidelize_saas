import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { WorkspaceNav } from "@/components/workspace-nav";
import { logout } from "@/app/auth/actions";
import "../painel.css";
export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const { company, role } = await requireCompany(companyId);
  return (
    <main className="workspace-shell">
      <a href="#workspace-content" className="workspace-skip-link">
        Ir para o conteúdo
      </a>
      <header className="workspace-header">
        <Link className="brand" href={`/painel/${companyId}`}>
          web<span>fidelize</span>
        </Link>
        <div className="workspace-account">
          <span className="company-avatar" aria-hidden="true">
            {company.name.slice(0, 2).toLocaleUpperCase("pt-BR")}
          </span>
          <div>
            <strong>{company.name}</strong>
            <span>
              {
                {
                  OWNER: "Proprietário",
                  MANAGER: "Gerente",
                  EMPLOYEE: "Colaborador",
                }[role]
              }
            </span>
          </div>
          <form action={logout}>
            <button className="secondary">Sair</button>
          </form>
        </div>
      </header>
      <div className="workspace-grid">
        <WorkspaceNav companyId={companyId} role={role} />
        <div id="workspace-content" className="workspace-content">
          {company.is_demo && (
            <p className="notice">
              <strong>Ambiente de demonstração.</strong> Empresa e cadastros
              fictícios para testar os fluxos.
            </p>
          )}
          {children}
        </div>
      </div>
    </main>
  );
}
