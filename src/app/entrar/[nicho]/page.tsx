import Link from "next/link";
import { notFound } from "next/navigation";
import { niches } from "@/lib/catalog";
import { login } from "@/app/auth/actions";
export const dynamicParams = false;
export function generateStaticParams() {
  return niches.map((n) => ({ nicho: n.slug }));
}
export default async function NicheLogin({
  params,
}: {
  params: Promise<{ nicho: string }>;
}) {
  const { nicho } = await params;
  const n = niches.find((n) => n.slug === nicho);
  if (!n) notFound();
  return (
    <main>
      <nav>
        <Link className="brand" href="/">
          web<span>fidelize</span>
        </Link>
        <Link href="/entrar">Todos os segmentos</Link>
      </nav>
      <section
        className="panel auth"
        style={{ borderTop: `3px solid ${n.color}` }}
      >
        <span className="icon" style={{ color: n.color }}>
          {n.icon}
        </span>
        <h1>{n.name}</h1>
        <p>{n.description}</p>
        <p>
          Entre com sua conta. O acesso depende do seu vínculo com a empresa.
        </p>
        <form action={login}>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
          />
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete="current-password"
          />
          <button>Entrar →</button>
        </form>
        <p>
          <Link href="/recuperar">Recuperar senha</Link> ·{" "}
          <Link href="/cadastro">Criar conta</Link>
        </p>
      </section>
    </main>
  );
}
