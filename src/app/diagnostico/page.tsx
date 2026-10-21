import Link from "next/link";
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import { PublicInquiryForm } from "@/components/sales/public-inquiry-form";
import { getSalesOffers } from "@/lib/sales-server";
import { site } from "@/lib/seo";
import "./diagnostico.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Implantação acompanhada | Web Fidelize",
  description:
    "Conte sobre sua operação e solicite um diagnóstico para a implantação de agenda, clientes, serviços e equipe na Web Fidelize. Escopo e investimento sob consulta.",
  alternates: { canonical: new URL("/diagnostico", site.url).href },
  robots: { index: site.indexable, follow: site.indexable },
};

function attributionValue(value: string | string[] | undefined) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f<>]/g, "")
        .trim()
        .slice(0, 120)
    : "";
}

export default async function Diagnosis({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [offers, params] = await Promise.all([getSalesOffers(), searchParams]);
  const selectedOffer =
    typeof params.produto === "string"
      ? offers?.find((offer) => offer.slug === params.produto)
      : undefined;
  const whatsapp =
    "https://wa.me/5518997695445?text=Ol%C3%A1!%20Quero%20conversar%20sobre%20a%20implanta%C3%A7%C3%A3o%20acompanhada%20da%20Web%20Fidelize.";
  return (
    <main className="sales-public">
      <a className="sales-skip" href="#solicitar-diagnostico">
        Ir para a solicitação
      </a>
      <nav className="sales-navigation" aria-label="Navegação da implantação">
        <Brand />
        <Link href="/planos" className="sales-nav-link">
          Conhecer os planos
        </Link>
        <Link href="/entrar" className="button secondary">
          Entrar
        </Link>
      </nav>
      <header className="sales-hero">
        <span className="sales-eyebrow">
          <span aria-hidden="true" /> IMPLANTAÇÃO ACOMPANHADA
        </span>
        <h1>
          Seu negócio tem uma rotina.
          <br />
          <em>Vamos organizar o começo.</em>
        </h1>
        <p>
          Agenda, clientes, serviços e equipe. Converse com a Web Fidelize sobre
          a configuração da plataforma para a sua operação, com escopo e
          investimento definidos em uma proposta.
        </p>
        <div className="sales-hero-facts">
          <span>
            <Icon name="check" size={16} /> Necessidade antes da proposta
          </span>
          <span>
            <Icon name="check" size={16} /> Recursos que já existem
          </span>
          <span>
            <Icon name="check" size={16} /> Contratação sob consulta
          </span>
        </div>
      </header>
      <div className="sales-diagnosis-layout">
        <aside
          className="sales-guidance"
          aria-labelledby="sales-guidance-title"
        >
          <span className="sales-eyebrow">COMECE COM DIREÇÃO</span>
          <h2 id="sales-guidance-title">
            Menos dúvidas na configuração.
            <br />
            Mais clareza para operar.
          </h2>
          <p>
            O diagnóstico ajuda a entender o seu cenário e o apoio necessário. A
            conversa define o que entra na implantação.
          </p>
          <ul className="sales-scope">
            <li>
              <span>
                <Icon name="calendar" />
              </span>
              <div>
                <strong>Agenda preparada para a rotina</strong>
                <p>
                  Serviços, duração, profissionais e disponibilidade de
                  atendimento.
                </p>
              </div>
            </li>
            <li>
              <span>
                <Icon name="users" />
              </span>
              <div>
                <strong>Clientes e equipe organizados</strong>
                <p>
                  Cadastros, acesso ao painel e orientação de uso dos recursos
                  disponíveis.
                </p>
              </div>
            </li>
            <li>
              <span>
                <Icon name="link" />
              </span>
              <div>
                <strong>Sua página de agendamento</strong>
                <p>
                  Configuração da identidade e do link que você compartilha com
                  os clientes.
                </p>
              </div>
            </li>
          </ul>
          <div className="sales-process">
            <h3>Depois da solicitação</h3>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Entender</strong>
                  <p>Conversar sobre a rotina e as prioridades informadas.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Definir</strong>
                  <p>Alinhar o escopo, o investimento e as condições.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Combinar</strong>
                  <p>
                    Confirmar os próximos passos antes de iniciar o serviço.
                  </p>
                </div>
              </li>
            </ol>
          </div>
          <a
            href={whatsapp}
            className="sales-help-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="phone" size={17} /> Prefere conversar pelo WhatsApp?{" "}
            <Icon name="arrow-up-right" size={15} />
          </a>
        </aside>
        <section
          id="solicitar-diagnostico"
          className="sales-form-card"
          aria-labelledby="sales-form-title"
        >
          <header className="sales-form-heading">
            <span className="sales-kicker">VAMOS ENTENDER SEU CENÁRIO</span>
            <h2 id="sales-form-title">Solicite um diagnóstico.</h2>
            <p>
              Três etapas para apresentar seu negócio. Sem pagamento ou reunião
              automática.
            </p>
          </header>
          {offers?.length ? (
            <PublicInquiryForm
              offers={offers}
              selectedOfferId={selectedOffer?.id ?? ""}
              requestId={randomUUID()}
              attribution={{
                utm_source: attributionValue(params.utm_source),
                utm_medium: attributionValue(params.utm_medium),
                utm_campaign: attributionValue(params.utm_campaign),
              }}
            />
          ) : (
            <div className="sales-unavailable" role="status">
              <Icon name="help" size={28} />
              <h3>
                {offers === null
                  ? "Não foi possível carregar os serviços."
                  : "Converse sobre a sua implantação."}
              </h3>
              <p>
                {offers === null
                  ? "Tente novamente mais tarde ou fale com a equipe comercial pelo WhatsApp."
                  : "As opções de implantação ainda não estão abertas para solicitação por este formulário. Consulte a equipe pelo WhatsApp."}
              </p>
              <a
                className="sales-primary"
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
              >
                Falar no WhatsApp <Icon name="arrow-up-right" size={16} />
              </a>
            </div>
          )}
        </section>
      </div>
      <section
        className="sales-questions"
        aria-labelledby="sales-questions-title"
      >
        <div>
          <span className="sales-eyebrow">CONDIÇÕES CLARAS</span>
          <h2 id="sales-questions-title">Antes de enviar.</h2>
          <p>Uma decisão bem informada começa com um escopo que faz sentido.</p>
        </div>
        <div>
          <details>
            <summary>
              A implantação está incluída na assinatura?
              <Icon name="plus" size={17} />
            </summary>
            <p>
              O acompanhamento de implantação é um serviço com escopo e
              investimento sob consulta. A assinatura da plataforma e seus
              limites são apresentados separadamente. As condições são
              confirmadas na proposta.
            </p>
          </details>
          <details>
            <summary>
              O diagnóstico agenda uma reunião?
              <Icon name="plus" size={17} />
            </summary>
            <p>
              Não. O formulário registra sua solicitação para contato comercial.
              Se uma conversa ou reunião fizer sentido, os detalhes serão
              combinados com você.
            </p>
          </details>
          <details>
            <summary>
              Quais recursos podem entrar no projeto?
              <Icon name="plus" size={17} />
            </summary>
            <p>
              O foco é o núcleo disponível: agenda, clientes, serviços,
              profissionais, disponibilidade, acessos e página pública de
              agendamento. Automações de WhatsApp, prontuário, caixa, rotas e
              agentes de IA não fazem parte desta oferta de implantação dos
              recursos atuais.
            </p>
          </details>
          <details>
            <summary>
              Posso conhecer o sistema por conta própria?
              <Icon name="plus" size={17} />
            </summary>
            <p>
              Sim. O <Link href="/cadastro">teste gratuito de 7 dias</Link>{" "}
              continua disponível no plano Essencial, com um profissional na
              agenda. O período começa ao criar sua empresa, sem cartão ou
              cobrança automática.
            </p>
          </details>
        </div>
      </section>
      <footer className="sales-footer">
        <Link href="/">
          Voltar à Web Fidelize <Icon name="arrow-right" size={16} />
        </Link>
        <Link href="/planos">Comparar os planos da plataforma</Link>
      </footer>
    </main>
  );
}
