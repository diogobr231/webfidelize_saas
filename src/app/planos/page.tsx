import Link from "next/link";
import { commercialPlans } from "@/lib/commercial";
import { Brand } from "@/components/ui/brand";
import { PageHeader } from "@/components/ui/page-header";
import { PlansComparison } from "@/components/plans-comparison";
import { site } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Planos e condições | Web Fidelize",
  description:
    "Compare planos e limites da agenda online Web Fidelize. Teste grátis por 7 dias no Essencial, sem cartão e sem cobrança automática.",
  alternates: { canonical: new URL("/planos", site.url).href },
  robots: { index: site.indexable, follow: site.indexable },
};
export default async function Plans() {
  const plans = await commercialPlans();
  return (
    <main className="plans-public">
      <nav>
        <Brand />
        <Link className="button secondary" href="/entrar">
          Entrar
        </Link>
      </nav>
      <PageHeader
        eyebrow="Escolha o espaço para sua equipe"
        title="Um plano para cada tamanho de agenda."
        description="Compare os limites e conheça os recursos disponíveis para organizar sua agenda e sua equipe."
      />
      <PlansComparison plans={plans} />
    </main>
  );
}
