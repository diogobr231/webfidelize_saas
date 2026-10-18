import Link from "next/link";
import { requireCompany } from "@/lib/auth";
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
    <main>
      <nav>
        <Link className="brand" href="/painel">
          web<span>fidelize</span>
        </Link>
        <span className="badge">
          {company.name} · {role}
        </span>
      </nav>
      <div className="dashboard">
        <aside className="sidebar">
          {[
            ["", "Visão geral"],
            ["customers", "Clientes"],
            ["services", "Serviços"],
            ["professionals", "Profissionais"],
            ["agenda", "Agenda"],
            ["disponibilidade", "Disponibilidade"],
            ["equipe", "Equipe"],
          ].map(([path, name]) => (
            <Link key={path} href={`/painel/${companyId}/${path}`}>
              {name}
            </Link>
          ))}
          <Link href="/painel">Trocar empresa</Link>
          <a
            href="https://wa.me/5518997695445"
            target="_blank"
            rel="noreferrer"
          >
            Suporte ↗
          </a>
        </aside>
        <div>
          {company.is_demo && (
            <p className="notice">
              DEMONSTRAÇÃO — empresa e cadastros fictícios para testar o
              sistema.
            </p>
          )}
          {children}
        </div>
      </div>
    </main>
  );
}
