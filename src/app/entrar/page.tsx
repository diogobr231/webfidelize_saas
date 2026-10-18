import Link from "next/link";
import { login } from "@/app/auth/actions";
import { configured } from "@/lib/supabase/server";
import { niches } from "@/lib/catalog";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string }>;
}) {
  const params = await searchParams;
  return (
    <main>
      <nav>
        <Link className="brand" href="/">
          web<span>fidelize</span>
        </Link>
        <Link href="/cadastro">Criar conta →</Link>
      </nav>
      <section className="auth panel">
        <span className="tag">BEM-VINDO DE VOLTA</span>
        <h1>Seu negócio começa por aqui.</h1>
        <p>Acesse sua conta para continuar.</p>
        {!configured() && (
          <div className="notice">
            Ambiente em implantação. A conexão segura com o Supabase ainda
            precisa ser configurada.
          </div>
        )}
        {params.erro && (
          <div role="alert" className="notice error">
            {params.erro === "configuracao"
              ? "A autenticação ainda não foi configurada."
              : "Não foi possível entrar. Confira suas credenciais ou solicite um novo link."}
          </div>
        )}
        {params.aviso && (
          <div role="status" className="notice">
            Verifique seu e-mail para confirmar o cadastro antes de entrar.
          </div>
        )}
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
            maxLength={128}
            required
            autoComplete="current-password"
          />
          <button style={{ width: "100%" }}>Entrar na minha conta →</button>
        </form>
        <p>
          <Link href="/recuperar">Esqueci minha senha</Link>
        </p>
      </section>
      <div className="auth">
        <p>Uma entrada para cada rotina</p>
        <div className="actions">
          {niches.map((n) => (
            <Link className="badge" key={n.slug} href={`/entrar/${n.slug}`}>
              {n.name}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
