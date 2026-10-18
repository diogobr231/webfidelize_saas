import Link from "next/link";
import { notFound } from "next/navigation";
import { niches } from "@/lib/catalog";
import { login } from "@/app/auth/actions";
import { AuthShell } from "@/components/auth-shell";
import { PendingButton } from "@/components/pending-button";
import { Icon } from "@/components/ui/icon";

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
}: {
  params: Promise<{ nicho: string }>;
}) {
  const { nicho } = await params;
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
          <Link href="/entrar">Todos os segmentos</Link>
          <p>
            É seu primeiro acesso? <Link href="/cadastro">Criar conta</Link>
          </p>
        </>
      }
    >
      <div className="auth-niche-mark">
        <Icon name={nicheIcons[n.slug]} />
      </div>
      <form action={login}>
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          required
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
