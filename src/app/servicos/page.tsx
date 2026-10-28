import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import { getSalesOffers } from "@/lib/sales-server";
import { managedServices } from "@/lib/managed-services";
import { money } from "@/lib/catalog";
import { site } from "@/lib/seo";
import "./services.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Serviços para digitalizar seu negócio | Web Fidelize",
  description:
    "Agenda integrada, conteúdo para redes sociais, gestão de tráfego pago e fotografia mensal por parceiros locais. Conheça escopos e solicite uma proposta.",
  alternates: { canonical: new URL("/servicos", site.url).href },
};
export default async function Services() {
  const offers = await getSalesOffers();
  const price = (slug: string) => {
    const value = offers?.find((o) => o.slug === slug)?.monthly_price_cents;
    return value == null ? "Sob consulta" : `${money(value)}/mês`;
  };
  return (
    <main className="services-site">
      <a className="services-skip" href="#services-main">
        Ir para os serviços
      </a>
      <nav className="services-nav" aria-label="Navegação de serviços">
        <Brand />
        <div>
          <Link href="/">A plataforma</Link>
          <Link href="/planos">Planos do SaaS</Link>
          <Link href="/entrar" className="button secondary">
            Entrar
          </Link>
        </div>
      </nav>
      <header className="services-hero" id="services-main">
        <div>
          <span className="services-eyebrow">DA AGENDA À PRESENÇA DIGITAL</span>
          <h1>Cansado de cuidar das suas redes sociais?</h1>
          <p>
            Você cuida do seu negócio. A gente combina conteúdo, anúncios e uma
            agenda pronta para receber os próximos clientes.
          </p>
          <a className="button" href="#modulos">
            Encontre seu módulo <Icon name="arrow-right" size={18} />
          </a>
          <small>Serviços sob proposta, com escopo e início combinados.</small>
        </div>
        <figure>
          <Image
            src="/demo/photos/content-team.webp"
            width="1000"
            height="667"
            alt="Profissionais preparando conteúdo em um computador; foto ilustrativa de banco de imagens"
            decoding="async"
            sizes="(max-width: 760px) 100vw, 50vw"
            preload
          />
          <figcaption>Foto ilustrativa · CoWomen / Unsplash</figcaption>
        </figure>
      </header>
      <section className="services-mission">
        <Icon name="building" size={30} />
        <div>
          <span className="services-eyebrow">NOSSA MISSÃO</span>
          <h2>A missão da Web Fidelize é digitalizar negócios.</h2>
          <p>
            Organizar a operação e aproximar sua empresa das pessoas, com
            tecnologia e atendimento humano.
          </p>
        </div>
      </section>
      <section id="modulos" className="services-section">
        <div className="services-section-title">
          <span className="services-eyebrow">
            ESCOLHA O QUE FAZ SENTIDO AGORA
          </span>
          <h2>Quatro módulos. Um negócio mais conectado.</h2>
          <p>
            Contrate separadamente ou combine os serviços. A assinatura do SaaS
            tem seu próprio plano.
          </p>
        </div>
        <div className="services-grid">
          {managedServices.map((item, index) => (
            <article className="services-card" key={item.id}>
              <div className="services-card-top">
                <span>0{index + 1}</span>
                <Icon name={item.icon} size={25} />
              </div>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              <div className="services-price">
                <small>
                  {item.id === "agenda"
                    ? "Assinatura da plataforma"
                    : "A partir de"}
                </small>
                <strong>
                  {item.id === "agenda" ? "Conforme o plano" : price(item.slug)}
                </strong>
              </div>
              <ul>
                {item.scope.map((line) => (
                  <li key={line}>
                    <Icon name="check" size={15} />
                    {line}
                  </li>
                ))}
              </ul>
              <Link
                href={
                  item.id === "agenda"
                    ? "/planos"
                    : `/diagnostico?produto=${item.slug}`
                }
                className="button secondary"
              >
                {item.id === "agenda"
                  ? "Ver planos da agenda"
                  : "Solicitar proposta"}
                <Icon name="arrow-right" size={16} />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section className="services-combo">
        <div>
          <span className="services-eyebrow">CONTEÚDO + TRÁFEGO</span>
          <h2>Presença constante. Investimento com direção.</h2>
          <p>
            Até 30 posts de imagem por mês, legendas e programação em
            Instagram/Facebook, mais a gestão de 1 conta Meta Ads com verba de
            até R$ 1.500/mês.
          </p>
          <strong className="services-combo-price">
            A partir de {price("gestao-digital-combo")}
          </strong>
          <p className="services-small">
            Verba de anúncios, SaaS e fotografia cobrados separadamente. Sem
            promessa de seguidores, alcance ou vendas. A proposta define
            revisões, início, autorizações e condições.
          </p>
        </div>
        <div>
          <Link
            className="button"
            href="/diagnostico?produto=gestao-digital-combo"
          >
            Quero conversar sobre o combo <Icon name="arrow-right" size={18} />
          </Link>
          <span>
            Fotografia opcional: a partir de {price("fotografia-mensal")},
            sujeita ao orçamento da sua cidade e deslocamento.
          </span>
        </div>
      </section>
      <section className="services-section">
        <div className="services-section-title">
          <span className="services-eyebrow">DO MATERIAL À PUBLICAÇÃO</span>
          <h2>Você aprova. A gente organiza o caminho.</h2>
        </div>
        <ol className="services-steps">
          <li>
            <span>1</span>
            <h3>Fotos e briefing</h3>
            <p>
              Você envia fotos autorizadas. Combinamos ajustes de luz e arte com
              IA ou uma visita de fotógrafo parceiro.
            </p>
          </li>
          <li>
            <span>2</span>
            <h3>Conteúdo revisado</h3>
            <p>
              Preparamos legenda, hashtags e peças. Você confere a identidade e
              as informações antes de aprovar.
            </p>
          </li>
          <li>
            <span>3</span>
            <h3>Calendário combinado</h3>
            <p>
              Definimos canais, dias e horários. O início das publicações
              depende da conexão autorizada das contas.
            </p>
          </li>
          <li>
            <span>4</span>
            <h3>Anúncios com limite</h3>
            <p>
              Definimos verba e destino. O investimento na plataforma de
              anúncios só começa após sua autorização.
            </p>
          </li>
        </ol>
      </section>
      <section className="services-faq services-section">
        <h2>Antes de contratar</h2>
        <details>
          <summary>O dinheiro do anúncio está incluído?</summary>
          <p>
            Não. A mensalidade remunera a gestão. A verba de mídia é escolhida
            por você e paga diretamente à Meta. Nenhum pagamento começa ao
            solicitar a proposta.
          </p>
        </details>
        <details>
          <summary>Vocês enviam fotógrafo para qualquer cidade?</summary>
          <p>
            Buscamos parceiros locais conforme a cidade informada. Só
            confirmamos a visita após consultar disponibilidade, estúdio,
            deslocamento e orçamento. O valor “a partir de” não garante
            cobertura ou preço igual em todas as cidades.
          </p>
        </details>
        <details>
          <summary>É um post todos os dias?</summary>
          <p>
            O escopo inicial é de até 30 posts de imagem por mês. Definimos a
            distribuição no calendário; meses com 31 dias, vídeos, carrosséis
            complexos e volumes extras são combinados na proposta.
          </p>
        </details>
        <details>
          <summary>A IA substitui as fotos do meu negócio?</summary>
          <p>
            Podemos combinar artes genéricas e tratamento de material
            autorizado. Imagens ilustrativas não serão apresentadas como fotos
            reais da sua equipe ou dos seus resultados. Produção com IA e
            revisões são definidas antes de contratar.
          </p>
        </details>
        <details>
          <summary>Como o agendamento entra no SaaS?</summary>
          <p>
            Seu negócio tem um link público, com serviços, profissionais e
            disponibilidade. Quando a reserva é concluída, ela aparece na agenda
            da empresa. O módulo exige assinatura e configuração da plataforma.
          </p>
        </details>
      </section>
      <footer className="services-footer">
        <Brand />
        <p>A missão da Web Fidelize é digitalizar negócios.</p>
        <Link href="/diagnostico?produto=gestao-digital-combo">
          Vamos conversar <Icon name="arrow-right" size={16} />
        </Link>
        <Link href="/">Voltar ao início</Link>
        <a href="mailto:contato@webfidelize.com">contato@webfidelize.com</a>
      </footer>
    </main>
  );
}
