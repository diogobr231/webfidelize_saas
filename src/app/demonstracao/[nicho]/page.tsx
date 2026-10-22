import Link from "next/link";
import { notFound } from "next/navigation";
import { niches } from "@/lib/catalog";
import { segmentBySlug } from "@/lib/segments";
import { Brand } from "@/components/ui/brand";
import { InteractiveDemo } from "@/components/landing/interactive-demo";
import "../experience.css";
export function generateStaticParams() {
  return niches.map((n) => ({ nicho: n.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ nicho: string }>;
}) {
  const n = segmentBySlug((await params).nicho);
  return {
    title: `Demonstração${n ? ` para ${n.name}` : ""} | Web Fidelize`,
    robots: { index: false, follow: true },
  };
}
export default async function Demo({
  params,
}: {
  params: Promise<{ nicho: string }>;
}) {
  const n = segmentBySlug((await params).nicho);
  if (!n) notFound();
  return (
    <main className="experience">
      <nav className="experience-nav" aria-label="Navegação da demonstração">
        <Brand />
        <Link href={`/segmentos/${n.slug}`}>Benefícios</Link>
        <Link href="/entrar">Já sou cliente</Link>
      </nav>
      <header className="experience-intro">
        <span className="experience-eyebrow">
          DEMONSTRAÇÃO · {n.name.toUpperCase()}
        </span>
        <h1>Veja sua rotina ganhar forma.</h1>
        <p>
          Explore com exemplos. As alterações ficam apenas nesta página, somem
          ao recarregar e não criam reservas, contas ou cobranças.
        </p>
      </header>
      {!n.available ? <p className="demo-feedback">{n.limitation}</p> : null}
      <InteractiveDemo key={n.slug} services={n.services} />
      <section className="experience-next">
        <div>
          <h2>Faz sentido para o seu negócio?</h2>
          <p>Conheça os planos ou conte o que você precisa organizar.</p>
        </div>
        <div className="experience-actions">
          <Link className="button" href="/diagnostico">
            Descreva o que você busca
          </Link>
          <Link className="button secondary" href="/planos">
            Ver planos
          </Link>
        </div>
      </section>
      <footer className="experience-footer">
        <Link href="/demonstracao">Experimentar outro segmento</Link>
        <Link href={`/segmentos/${n.slug}`}>Voltar aos benefícios</Link>
      </footer>
    </main>
  );
}
