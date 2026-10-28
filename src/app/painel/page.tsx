import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { niches } from "@/lib/catalog";
import { logout } from "@/app/auth/actions";
import "./painel.css";
import { Brand } from "@/components/ui/brand";
export const dynamic = "force-dynamic";
export default async function Companies({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; empresas?: string }>;
}) {
  const { db, user } = await requireUser();
  const p = await searchParams;
  const [memberships, adminResult] = await Promise.all([
    db.from("memberships").select("company_id,role").eq("user_id", user.id),
    db.rpc("is_super_admin"),
  ]);
  if (!adminResult.error && adminResult.data === true && p.empresas === "1")
    redirect("/admin/espacos");
  const { data: companies, error } = memberships.data?.length
    ? await db
        .from("companies")
        .select("id,name,niche,status")
        .in(
          "id",
          memberships.data.map((m) => m.company_id),
        )
    : { data: [], error: memberships.error };
  const admin = adminResult.data;
  const loadError = error || memberships.error || adminResult.error;
  const companyHref = (company: { id: string; status: string }) => {
    const role = memberships.data?.find(
      (membership) => membership.company_id === company.id,
    )?.role;
    return `/painel/${company.id}${role === "EMPLOYEE" ? "/meu-dia" : company.status === "pending_card" && (role === "OWNER" || role === "MANAGER") ? "/assinatura" : ""}`;
  };
  if (!loadError && !p.erro && p.empresas !== "1") {
    if (companies?.length === 1) redirect(companyHref(companies[0]));
    if (!companies?.length && !admin) redirect("/comecar");
  }
  const alreadyOwner = memberships.data?.some(
    (member) => member.role === "OWNER",
  );
  return (
    <main className="workspace-shell companies-page">
      <nav>
        <Brand />
        <div className="links">
          {admin && <Link href="/admin">Super admin</Link>}
          <form action={logout}>
            <button className="secondary">Sair</button>
          </form>
        </div>
      </nav>
      <span className="tag">Seu espaço na Web Fidelize</span>
      <h1>Suas empresas</h1>
      <p>Escolha onde quer trabalhar hoje.</p>
      {(p.erro || loadError) && (
        <div role="alert" className="notice error">
          Não foi possível concluir. Verifique suas permissões e a instalação do
          banco.
        </div>
      )}
      <div className="grid">
        {companies?.map((c) => (
          <Link className="card" key={c.id} href={companyHref(c)}>
            <span className="company-avatar" aria-hidden="true">
              {c.name.slice(0, 2).toLocaleUpperCase("pt-BR")}
            </span>
            <h3>{c.name}</h3>
            <p>{niches.find((n) => n.slug === c.niche)?.name}</p>
            <span className="workspace-text-link">
              {companyHref(c).endsWith("/assinatura")
                ? "Ver ativação do teste →"
                : "Abrir meu dia →"}
            </span>
          </Link>
        ))}
      </div>
      {alreadyOwner ? (
        <section className="panel company-create">
          <h2>Precisa gerenciar outra unidade?</h2>
          <p>
            Você já possui uma empresa. Fale com a equipe para organizar a
            expansão do seu atendimento.
          </p>
          <a
            className="button secondary"
            href="https://wa.me/5518997695445"
            target="_blank"
            rel="noreferrer"
          >
            Conversar com a equipe ↗
          </a>
        </section>
      ) : !loadError ? (
        <section className="panel company-create">
          <h2>
            {companies?.length
              ? "Prepare sua própria empresa"
              : "Bem-vindo à Web Fidelize"}
          </h2>
          <p>
            Cadastre sua empresa e segmento para começar. Em seguida, configure
            os serviços e profissionais. Os cadastros salvos serão mantidos para
            continuar depois.
          </p>
          <p>
            Os 7 dias grátis no Essencial começam ao criar sua empresa, sem
            cartão e sem cobrança automática. O prazo aparece no painel; entrar
            novamente não renova o período de teste.
          </p>
          <Link className="button" href="/comecar">
            Continuar configuração →
          </Link>
        </section>
      ) : null}
    </main>
  );
}
