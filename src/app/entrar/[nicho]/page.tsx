import Link from "next/link";
import { PasswordInput } from "@/components/password-input";
import { notFound } from "next/navigation";
import { login } from "@/app/auth/actions";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";
import { authDestination, authPageUrl } from "@/lib/auth-flow";
import { niches } from "@/lib/catalog";
import { segmentBySlug } from "@/lib/segments";

const nicheIcons = {
  salao: "scissors",
  "pet-shop": "paw",
  clinica: "heart",
  escritorio: "briefcase",
  restaurante: "utensils",
  fornecedores: "truck",
  logistica: "truck",
  academia: "dumbbell",
} as const;

export const dynamicParams = false;
export function generateStaticParams() {
  return niches.map((n) => ({ nicho: n.slug }));
}
export default async function NicheLogin({
  params,
  searchParams,
}: {
  params: Promise<{ nicho: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { nicho } = await params;
  const next = authDestination((await searchParams).next);
  const n = segmentBySlug(nicho);
  if (!n) notFound();
  return (
    <AuthShell
      eyebrow="ACESSO DO SEU SEGMENTO"
      title={n.name}
      description={n.description}
      footer={
        <>
          <Link href={authPageUrl("/entrar", { next })}>
            Todos os segmentos
          </Link>
          <p>
            Ainda está conhecendo?{" "}
            <Link href={`/segmentos/${n.slug}`}>
              Ver benefícios e demonstração
            </Link>
          </p>
        </>
      }
    >
      <div className="auth-niche-mark">
        <Icon name={nicheIcons[n.slug]} />
      </div>
      <form action={login}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="voce@empresa.com.br"
        />
        <div className="auth-password-label">
          <label htmlFor="password">Senha</label>
          <Link href="/recuperar">Recuperar senha</Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          minLength={8}
          maxLength={128}
          required
          autoComplete="current-password"
          placeholder="Sua senha de acesso"
        />
        <PendingButton pendingLabel="Entrando…">
          Entrar <Icon name="arrow-right" />
        </PendingButton>
      </form>
      <p className="auth-access-note">
        Entre com sua conta. O acesso depende do seu vínculo com a empresa.
      </p>
      <section
        className="auth-niche-features"
        aria-labelledby="auth-niche-features-title"
      >
        <h2 id="auth-niche-features-title">
          Recursos para {n.name.toLowerCase()}
        </h2>
        <ul>
          {n.features.map((feature) => (
            <li key={feature}>
              <Icon name="check" size={16} />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <p>{n.limitation}</p>
        <Link href={`/demonstracao/${n.slug}`}>
          Conhecer a demonstração deste segmento
          <Icon name="arrow-right" size={15} />
        </Link>
      </section>
    </AuthShell>
  );
}
