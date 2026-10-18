import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { niches } from "@/lib/catalog";
import { createCompany } from "./actions";
import { logout } from "@/app/auth/actions";
import { PendingButton } from "@/components/pending-button";
import "./painel.css";
export const dynamic = "force-dynamic";
export default async function Companies({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; empresas?: string }>;
}) {
  const { db, user } = await requireUser();
  const p = await searchParams;
  const memberships = await db
    .from("memberships")
    .select("company_id,role")
    .eq("user_id", user.id);
  const { data: companies, error } = memberships.data?.length
    ? await db
        .from("companies")
        .select("id,name,niche")
        .in(
          "id",
          memberships.data.map((m) => m.company_id),
        )
    : { data: [], error: memberships.error };
  if (!error && !p.erro && p.empresas !== "1" && companies?.length === 1) {
    redirect(`/painel/${companies[0].id}`);
  }
  const { data: admin } = await db.rpc("is_super_admin");
  const alreadyOwner = memberships.data?.some(
    (member) => member.role === "OWNER",
  );
  return (
    <main className="workspace-shell companies-page">
      <nav>
        <Link className="brand" href="/">
          web<span>fidelize</span>
        </Link>
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
      {(p.erro || error) && (
        <div role="alert" className="notice error">
          Não foi possível concluir. Verifique suas permissões e a instalação do
          banco.
        </div>
      )}
      <div className="grid">
        {companies?.map((c) => (
          <Link className="card" key={c.id} href={`/painel/${c.id}`}>
            <span className="company-avatar" aria-hidden="true">
              {c.name.slice(0, 2).toLocaleUpperCase("pt-BR")}
            </span>
            <h3>{c.name}</h3>
            <p>{niches.find((n) => n.slug === c.niche)?.name}</p>
            <span className="workspace-text-link">Abrir meu dia →</span>
          </Link>
        ))}
      </div>
      {!companies?.length && !error && (
        <p className="empty">
          Sua jornada começa aqui. Cadastre sua primeira empresa.
        </p>
      )}
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
      ) : (
        <section className="panel company-create">
          <h2>
            {companies?.length
              ? "Criar outra empresa"
              : "Vamos conhecer seu negócio"}
          </h2>
          <p>
            Seu teste gratuito de sete dias começa ao criar a empresa. O plano
            inicial permite um profissional.
          </p>
          <form action={createCompany}>
            <label htmlFor="name">Nome da empresa</label>
            <input
              id="name"
              name="name"
              minLength={2}
              maxLength={100}
              required
            />
            <label htmlFor="niche">Segmento</label>
            <select id="niche" name="niche">
              {niches.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.name}
                </option>
              ))}
            </select>
            <PendingButton pendingLabel="Criando sua empresa…">
              Criar e começar teste gratuito →
            </PendingButton>
          </form>
        </section>
      )}
    </main>
  );
}
