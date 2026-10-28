import Link from "next/link";
import { segmentBySlug } from "@/lib/segments";
import { niches } from "@/lib/catalog";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import "./experience.css";
export const metadata = {
  title: "Experimente a demonstração | Web Fidelize",
  description:
    "Escolha seu segmento e experimente a agenda com dados de exemplo, sem login.",
  robots: { index: false, follow: true },
};
export default function Demonstration() {
  return (
    <main className="experience">
      <nav className="experience-nav" aria-label="Navegação da demonstração">
        <Brand />
        <Link href="/planos">Planos</Link>
        <Link href="/entrar">Já sou cliente</Link>
      </nav>
      <header className="experience-intro">
        <span className="experience-eyebrow">CONHEÇA ANTES DE ESCOLHER</span>
        <h1>Experimente a Web Fidelize.</h1>
        <p>
          Escolha seu segmento para explorar a agenda e a ficha do cliente. Sem
          login, sem cartão e com dados inteiramente fictícios.
        </p>
      </header>
      <div className="experience-grid">
        {niches.map((n) => (
          <article key={n.slug}>
            <h2>{n.name}</h2>
            <p>{segmentBySlug(n.slug)!.description}</p>
            <Link className="button" href={`/demonstracao/${n.slug}`}>
              Experimentar demonstração <Icon name="arrow-right" size={16} />
            </Link>
            <Link
              className="experience-text-link"
              href={`/segmentos/${n.slug}`}
            >
              Conhecer os benefícios
            </Link>
          </article>
        ))}
      </div>
      <section className="experience-scope">
        <Icon name="help" />
        <div>
          <h2>Sua operação tem uma necessidade diferente?</h2>
          <p>
            A demonstração pública apresenta uma agenda ilustrativa. Os fluxos
            administrativos variam conforme o segmento e ficam no painel da
            empresa; escolha um segmento para conhecer o escopo disponível.
          </p>
          <Link href="/diagnostico">Descreva o que você busca</Link>
        </div>
      </section>
    </main>
  );
}
