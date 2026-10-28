import Link from "next/link";
import { notFound } from "next/navigation";
import { niches } from "@/lib/catalog";
import { segmentBySlug } from "@/lib/segments";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
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
        <h1>{n.headline}</h1>
        <p>
          {n.description} A demonstração abaixo usa exemplos fictícios para
          mostrar a experiência de agendamento, agenda e ficha do cliente.
        </p>
      </header>
      <section
        className="demo-capabilities"
        aria-labelledby="demo-capabilities-title"
      >
        <div className="demo-capabilities-heading">
          <span className="experience-eyebrow">RECURSOS DO SEGMENTO</span>
          <h2 id="demo-capabilities-title">O que você organiza no painel</h2>
        </div>
        <ul>
          {n.features.map((feature) => (
            <li key={feature}>
              <Icon name="check" size={17} />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <div className="demo-capabilities-note">
          <p>{n.limitation}</p>
          <p>
            Na demonstração interativa, teste apenas o agendamento com dados de
            exemplo. Os resultados ficam temporariamente no navegador; não criam
            reservas reais nem alteram os dados de uma empresa.
          </p>
        </div>
      </section>
      <InteractiveDemo
        key={n.slug}
        services={n.services}
        segmentSlug={n.slug}
        segmentName={n.name}
      />
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
