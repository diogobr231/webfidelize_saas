import Link from "next/link";
import { notFound } from "next/navigation";
import { niches } from "@/lib/catalog";
import { login } from "@/app/auth/actions";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";
import { authDestination, authPageUrl } from "@/lib/auth-flow";

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
  const n = niches.find((n) => n.slug === nicho);
  if (!n) notFound();
  return (
    <AuthShell
      eyebrow="ACESSO DO SEU SEGMENTO"
      title={n.name}
      description={
        n.slug === "salao"
          ? "Agenda e clientes em um só lugar, com espaço para cuidar de cada atendimento."
          : n.description
      }
      footer={
        <>
          <Link href={authPageUrl("/entrar", { next })}>
            Todos os segmentos
          </Link>
          <p>
            É seu primeiro acesso?{" "}
            <Link href={authPageUrl("/cadastro", { next })}>Criar conta</Link>
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
        <input
          id="password"
          name="password"
          type="password"
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
    </AuthShell>
  );
}
