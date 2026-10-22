import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { niches } from "@/lib/catalog";
import { segmentBySlug } from "@/lib/segments";
import { site } from "@/lib/seo";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import "../../demonstracao/experience.css";

export function generateStaticParams() {
  return niches.map((n) => ({ nicho: n.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ nicho: string }>;
}): Promise<Metadata> {
  const n = segmentBySlug((await params).nicho);
  if (!n) return {};
  return {
    title: `${n.name}: agenda e clientes | Web Fidelize`,
    description: n.description,
    alternates: { canonical: new URL(`/segmentos/${n.slug}`, site.url).href },
    robots: { index: site.indexable, follow: site.indexable },
  };
}
export default async function Segment({
  params,
}: {
  params: Promise<{ nicho: string }>;
}) {
  const n = segmentBySlug((await params).nicho);
  if (!n) notFound();
  return (
    <main className="experience">
      <a href="#beneficios" className="experience-skip">
        Pular para os benefícios
      </a>
      <nav className="experience-nav" aria-label="Navegação do segmento">
        <Brand />
        <Link href="/#segmentos">Segmentos</Link>
        <Link href={`/entrar/${n.slug}`}>Já sou cliente</Link>
      </nav>
      <header className="experience-hero">
        <div>
          <span className="experience-eyebrow">
            WEB FIDELIZE PARA {n.name.toUpperCase()}
          </span>
          <h1>{n.headline}</h1>
          <p>{n.description}</p>
          <div className="experience-actions">
            <Link className="button" href={`/demonstracao/${n.slug}`}>
              Experimentar demonstração <Icon name="arrow-right" size={17} />
            </Link>
            <Link className="button secondary" href="/planos">
              Conhecer os planos
            </Link>
          </div>
          <small>
            Sem login e sem cartão. Exemplos fictícios para explorar o sistema.
          </small>
        </div>
        <aside className="experience-highlight">
          <Icon name="calendar" size={32} />
          <span>DO PRIMEIRO HORÁRIO AO PRÓXIMO ATENDIMENTO</span>
          <h2>Sua rotina merece ser mais simples.</h2>
          <ul>
            <li>
              <Icon name="check" />
              Horários e equipe organizados
            </li>
            <li>
              <Icon name="check" />
              Clientes e histórico por perto
            </li>
            <li>
              <Icon name="check" />
              Um link de reservas com sua marca
            </li>
          </ul>
        </aside>
      </header>
      <section id="beneficios" className="experience-section">
        <span className="experience-eyebrow">O QUE MUDA NA SUA ROTINA</span>
        <h2>Conheça os benefícios antes de entrar.</h2>
        <div className="experience-grid">
          {[
            {
              icon: "calendar" as const,
              title: "Encontre espaço na agenda",
              text: "Visualize o dia ou a semana, configure os horários de cada profissional e bloqueie períodos sem atendimento.",
            },
            {
              icon: "users" as const,
              title: "Atenda com contexto",
              text: "Mantenha os clientes organizados e consulte o histórico de atendimentos, respeitando as permissões da equipe.",
            },
            {
              icon: "link" as const,
              title: "Receba pelo seu próprio link",
              text: "Personalize a página de agendamento com logo, cores e foto do espaço. Seu cliente escolhe serviço, profissional e horário pelo celular.",
            },
          ].map((b) => (
            <article key={b.title}>
              <Icon name={b.icon} />
              <h3>{b.title}</h3>
              <p>{b.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="experience-scope">
        <Icon name="shield" />
        <div>
          <h2>
            {n.available
              ? "Clareza sobre o que está disponível"
              : "Módulo específico em planejamento"}
          </h2>
          <p>{n.limitation}</p>
          <p>
            Os avisos automáticos pelo WhatsApp dependem da conexão oficial, de
            modelos aprovados e da cota da empresa.
          </p>
        </div>
      </section>
      <section className="experience-next">
        <div>
          <span className="experience-eyebrow">VEJA NA PRÁTICA</span>
          <h2>Experimente um atendimento de exemplo.</h2>
          <p>
            Escolha um horário, veja a agenda mudar e explore a ficha de um
            cliente fictício.
          </p>
        </div>
        <Link className="button" href={`/demonstracao/${n.slug}`}>
          Abrir demonstração <Icon name="arrow-right" size={17} />
        </Link>
      </section>
      <footer className="experience-footer">
        <Link href="/diagnostico">Descreva o que você busca</Link>
        <Link href="/planos">Planos e condições</Link>
        <Link href={`/entrar/${n.slug}`}>Acessar minha conta</Link>
      </footer>
    </main>
  );
}
