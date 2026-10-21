import Link from "next/link";
import { money, niches } from "@/lib/catalog";
import { commercialPlans } from "@/lib/commercial";
import { landingStructuredData } from "@/lib/seo";
import { Icon } from "@/components/ui/icon";
import { Brand } from "@/components/ui/brand";
import { ProductTour } from "@/components/landing/product-tour";
import "./landing.css";

export { landingMetadata as metadata } from "@/lib/seo";
export const dynamic = "force-dynamic";

const whatsapp =
  "https://wa.me/5518997695445?text=Ol%C3%A1!%20Quero%20conhecer%20a%20Web%20Fidelize.";

function TrialLink({ secondary = false }: { secondary?: boolean }) {
  return (
    <Link
      className={`wf-button ${secondary ? "wf-button-outline" : ""}`}
      href="/cadastro"
    >
      Testar grátis por 7 dias
      <Icon name="arrow-right" />
    </Link>
  );
}

const questions = [
  {
    question: "O que posso organizar com a Web Fidelize?",
    answer:
      "Agenda diária e semanal, cadastro de clientes, serviços e profissionais, disponibilidade semanal e uma página pública para receber reservas. Você também pode remarcar e cancelar atendimentos pelo painel, conforme sua permissão.",
  },
  {
    question: "Como funcionam os 7 dias gratuitos?",
    answer:
      "Crie sua conta, confirme seu e-mail e cadastre a empresa. Os 7 dias começam na criação da empresa, com o plano Essencial e 1 profissional na agenda. O teste não solicita cartão e não gera cobrança automática.",
  },
  {
    question: "Meu cliente precisa instalar um aplicativo?",
    answer:
      "Não. Ele abre seu link no navegador, escolhe serviço, profissional e horário e informa nome e telefone para reservar. Não precisa criar uma conta. Ao concluir, recebe um comprovante na tela e pode adicionar o horário ao calendário.",
  },
  {
    question: "O proprietário conta no limite do plano?",
    answer:
      "Sim, se estiver cadastrado como profissional ativo que recebe agendamentos. O limite exibido em cada plano considera essas pessoas, e não os convites para acessar o painel. O preço exibido é mensal; fale conosco para conhecer as condições dos planos.",
  },
  {
    question: "Posso compartilhar minha agenda no WhatsApp?",
    answer:
      "Sim. Copie o link da sua página e compartilhe em conversas, no perfil do Instagram ou onde seus clientes encontrarem você. O compartilhamento é feito por você; mensagens, lembretes automáticos e chatbot ainda não estão disponíveis.",
  },
  {
    question: "O cliente consegue alterar a reserva sozinho?",
    answer:
      "Para remarcar ou cancelar, o cliente entra em contato com a empresa. Quem tem permissão no painel atualiza o agendamento. O link de confirmação permite consultar a situação e o horário atualizados da reserva.",
  },
  {
    question: "Já posso contratar e pagar pelo site?",
    answer:
      "A assinatura e a cobrança online ainda não estão disponíveis. Os valores apresentados são os preços previstos dos planos. Você pode usar o teste gratuito e falar pelo WhatsApp para conhecer a proposta para seu negócio.",
  },
  {
    question: "O sistema tem módulos específicos para cada segmento?",
    answer:
      "Hoje, os segmentos compartilham o núcleo de agenda, clientes e serviços. Recursos como prontuário, comandas, caixa, cadastro de pets, rotas, turmas e inteligência artificial não fazem parte da versão disponível.",
  },
];

export default async function Home() {
  const plans = await commercialPlans();
  return (
    <main className="wf-site" id="inicio">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(landingStructuredData).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />
      <a href="#conteudo" className="wf-skip">
        Pular para o conteúdo
      </a>
      <header className="wf-header">
        <nav
          className="wf-container wf-navigation"
          aria-label="Navegação principal"
        >
          <Brand href="/" className="wf-brand" />
          <div className="wf-nav-links">
            <a href="#como-funciona">Como funciona</a>
            <a href="#recursos">Recursos</a>
            <a href="#planos">Planos</a>
            <Link href="/diagnostico">Implantação</Link>
            <a href="#duvidas">Dúvidas</a>
          </div>
          <details className="wf-mobile-nav">
            <summary aria-label="Menu de navegação">
              <Icon name="menu" size={18} />
              <span>Menu</span>
            </summary>
            <div>
              <a href="#recursos">Recursos disponíveis</a>
              <a href="#demonstracao">Como seu cliente agenda</a>
              <a href="#como-funciona">Primeiros passos</a>
              <a href="#planos">Planos e condições</a>
              <Link href="/diagnostico">Implantação acompanhada</Link>
              <a href="#duvidas">Perguntas frequentes</a>
            </div>
          </details>
          <Link className="wf-login" href="/entrar">
            Entrar
            <Icon name="arrow-right" />
          </Link>
        </nav>
      </header>
      <section
        className="wf-container wf-hero"
        id="conteudo"
        aria-labelledby="hero-title"
      >
        <div className="wf-hero-copy">
          <span className="wf-eyebrow wf-hero-pill">
            <span />
            PARA QUEM ATENDE COM HORA MARCADA
          </span>
          <h1 id="hero-title">
            Sua agenda
            <br />
            organizada.
            <br />
            <em>
              Seu cliente
              <br className="wf-mobile-break" /> mais perto.
            </em>
          </h1>
          <p>
            Organize os atendimentos e a equipe em uma agenda online.
            Compartilhe seu link e deixe o cliente escolher entre os horários
            disponíveis, direto pelo celular.
          </p>
          <div className="wf-hero-actions">
            <TrialLink />
            <a
              className="wf-button wf-button-outline"
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="phone" />
              Falar no WhatsApp
            </a>
          </div>
          <div className="wf-trial-facts">
            <span>
              <Icon name="check" />
              Sem cartão para testar
            </span>
            <span>
              <Icon name="check" />
              Acesso pelo navegador
            </span>
          </div>
          <a className="wf-tour-link" href="#demonstracao">
            Veja como seu cliente agenda <Icon name="arrow-right" size={15} />
          </a>
        </div>
        <ProductTour />
      </section>
      <section
        className="wf-container wf-value-strip"
        aria-label="O essencial da Web Fidelize"
      >
        <div>
          <Icon name="calendar" />
          <span>
            Agenda visual<strong>Veja seu dia e sua semana.</strong>
          </span>
        </div>
        <div>
          <Icon name="link" />
          <span>
            Página de agendamento<strong>Receba reservas pelo seu link.</strong>
          </span>
        </div>
        <div>
          <Icon name="users" />
          <span>
            Clientes e profissionais
            <strong>Organize quem faz parte da rotina.</strong>
          </span>
        </div>
      </section>
      <section
        className="wf-container wf-section"
        id="recursos"
        aria-labelledby="features-title"
      >
        <div className="wf-section-heading">
          <span className="wf-eyebrow">MENOS IMPROVISO. MAIS ORGANIZAÇÃO.</span>
          <h2 id="features-title">
            Tudo o que conecta
            <br />
            um bom atendimento.
          </h2>
          <p>
            Do primeiro horário marcado à organização da equipe, o essencial
            fica ao seu alcance.
          </p>
        </div>
        <div className="wf-features-grid">
          <article className="wf-feature-card">
            <span className="wf-feature-icon">
              <Icon name="calendar" />
            </span>
            <span className="wf-feature-number">01</span>
            <h3>
              Enxergue sua agenda
              <br />
              com clareza.
            </h3>
            <p>
              Visualize o dia ou a semana, filtre por profissional e confira
              cliente, serviço e horário. Remarque ou cancele pelo painel.
            </p>
            <div className="wf-feature-detail">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="wf-feature-footnote">
              Conflitos de horário são verificados ao reservar.
            </span>
          </article>
          <article className="wf-feature-card">
            <span className="wf-feature-icon wf-icon-violet">
              <Icon name="link" />
            </span>
            <span className="wf-feature-number">02</span>
            <h3>
              Facilite a reserva
              <br />
              para seu cliente.
            </h3>
            <p>
              Compartilhe sua página no WhatsApp e Instagram. Seu cliente
              escolhe entre os horários disponíveis, sem criar conta.
            </p>
            <div className="wf-example-link">
              <Icon name="link" />
              <span>seu link de agendamento</span>
              <Icon name="arrow-right" />
            </div>
            <span className="wf-feature-footnote">
              Sem instalação de aplicativo.
            </span>
          </article>
          <article className="wf-feature-card">
            <span className="wf-feature-icon wf-icon-amber">
              <Icon name="users" />
            </span>
            <span className="wf-feature-number">03</span>
            <h3>
              Encontre as informações
              <br />
              que você precisa.
            </h3>
            <p>
              Encontre clientes pelo nome, consulte o histórico de atendimentos
              e mantenha contatos, serviços e profissionais organizados.
            </p>
            <div className="wf-feature-tags">
              <span>Clientes</span>
              <span>Serviços</span>
              <span>Profissionais</span>
            </div>
            <span className="wf-feature-footnote">
              Cada empresa acessa seus próprios dados.
            </span>
          </article>
        </div>
        <div className="wf-small-features">
          <article>
            <Icon name="clock" />
            <div>
              <h3>Disponibilidade do seu jeito</h3>
              <p>
                Defina turnos semanais e bloqueie períodos para pausas ou
                ausências.
              </p>
            </div>
          </article>
          <article>
            <Icon name="sparkles" />
            <div>
              <h3>Uma página com a sua identidade</h3>
              <p>
                Adicione seu logotipo, escolha entre 4 cores e exiba endereço e
                WhatsApp.
              </p>
            </div>
          </article>
          <article>
            <Icon name="settings" />
            <div>
              <h3>Configuração guiada</h3>
              <p>
                Prepare a empresa por etapas e retome de onde parou quando
                precisar.
              </p>
            </div>
          </article>
        </div>
      </section>
      <section
        className="wf-demo-band"
        id="demonstracao"
        aria-labelledby="demo-title"
      >
        <div className="wf-container wf-demo-layout">
          <div className="wf-demo-copy">
            <span className="wf-eyebrow">
              UMA RESERVA SIMPLES PARA SEU CLIENTE
            </span>
            <h2 id="demo-title">
              Do seu link
              <br />
              para a sua agenda.
            </h2>
            <p>
              Uma página pensada para quem quer agendar, com serviço,
              profissional, data e horário. Ao concluir, o cliente recebe a
              confirmação na tela.
            </p>
            <ol className="wf-demo-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Você compartilha o link.</strong>
                  <p>Coloque nas suas conversas e no perfil do negócio.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Seu cliente escolhe um horário.</strong>
                  <p>A página consulta a disponibilidade configurada.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>A reserva chega à sua agenda.</strong>
                  <p>Você acompanha e gerencia o atendimento no painel.</p>
                </div>
              </li>
            </ol>
            <Link className="wf-button" href="/cadastro">
              Criar minha página de agendamento
              <Icon name="arrow-right" />
            </Link>
            <p className="wf-demo-disclaimer">
              Exemplo ilustrativo da página de agendamento, com dados fictícios.
            </p>
          </div>
          <figure className="wf-phone-figure">
            <div className="wf-phone-orbit" />
            <div className="wf-phone">
              <div className="wf-phone-status" aria-hidden="true">
                <span>09:41</span>
                <span className="wf-phone-camera" />
                <span>▰</span>
              </div>
              <div className="wf-phone-content">
                <div className="wf-phone-business">
                  <span>EF</span>
                  <div>
                    <strong>Espaço Fictício</strong>
                    <small>Exemplo de página pública</small>
                  </div>
                </div>
                <span className="wf-phone-eyebrow">SEU PRÓXIMO HORÁRIO</span>
                <h3>
                  Reserve um tempo
                  <br />
                  para você.
                </h3>
                <p>Escolha seu serviço e encontre um horário.</p>
                <div className="wf-phone-service">
                  <span>
                    <strong>Serviço de exemplo</strong>
                    <small>30 minutos</small>
                  </span>
                  <span className="wf-phone-selected">✓</span>
                </div>
                <div className="wf-phone-professional">
                  <span>Profissional de exemplo</span>
                  <span>⌄</span>
                </div>
                <span className="wf-phone-label">Horários ilustrativos</span>
                <div className="wf-phone-times">
                  <span>09:00</span>
                  <span>09:30</span>
                  <span>10:00</span>
                  <span>10:30</span>
                  <span>11:00</span>
                  <span>11:30</span>
                </div>
                <div className="wf-phone-faux-button">
                  Confirmar agendamento <Icon name="arrow-right" />
                </div>
                <small className="wf-phone-footnote">
                  Visual ilustrativo · dados fictícios
                </small>
              </div>
            </div>
            <figcaption>
              Uma experiência que funciona no navegador do celular.
            </figcaption>
          </figure>
        </div>
      </section>
      <section
        className="wf-container wf-section"
        id="como-funciona"
        aria-labelledby="start-title"
      >
        <div className="wf-section-heading wf-heading-centered">
          <span className="wf-eyebrow">UM COMEÇO MAIS SIMPLES</span>
          <h2 id="start-title">
            Prepare sua agenda.
            <br />
            Compartilhe o próximo passo.
          </h2>
          <p>
            Você não precisa montar um site para começar a receber agendamentos.
          </p>
        </div>
        <div className="wf-setup-grid">
          <article>
            <span className="wf-setup-number">01</span>
            <h3>Crie seu espaço.</h3>
            <p>
              Cadastre sua conta, confirme o e-mail e crie sua empresa para
              iniciar os 7 dias de teste.
            </p>
          </article>
          <article>
            <span className="wf-setup-number">02</span>
            <h3>Organize sua rotina.</h3>
            <p>
              Adicione serviços e profissionais, configure os turnos e
              personalize a página de agendamento.
            </p>
          </article>
          <article>
            <span className="wf-setup-number">03</span>
            <h3>Coloque seu link no mundo.</h3>
            <p>
              Publique a página e compartilhe o endereço. Acompanhe os
              agendamentos pelo painel.
            </p>
          </article>
        </div>
        <div className="wf-centered-action">
          <TrialLink />
          <span>Teste no plano Essencial, com 1 profissional na agenda.</span>
        </div>
      </section>
      <section
        className="wf-container wf-segments"
        id="segmentos"
        aria-labelledby="segments-title"
      >
        <div>
          <span className="wf-eyebrow">
            PARA QUEM TRABALHA COM HORA MARCADA
          </span>
          <h2 id="segments-title">Seu negócio tem lugar aqui.</h2>
          <p>
            Um núcleo de agenda, clientes e serviços para organizar
            atendimentos.
          </p>
        </div>
        <div className="wf-segment-links">
          {niches.slice(0, 4).map((niche) => (
            <Link href={`/entrar/${niche.slug}`} key={niche.slug}>
              <Icon
                name={
                  niche.slug === "salao"
                    ? "scissors"
                    : niche.slug === "pet-shop"
                      ? "paw"
                      : niche.slug === "clinica"
                        ? "heart"
                        : "briefcase"
                }
              />
              {niche.name}
              <Icon name="arrow-right" />
            </Link>
          ))}
        </div>
        <div className="wf-other-segments">
          <span>Outros segmentos com módulos específicos em planejamento:</span>
          <div>
            {niches.slice(4).map((niche) => (
              <Link key={niche.slug} href={`/entrar/${niche.slug}`}>
                {niche.name}
                <Icon name="arrow-up-right" size={14} />
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section
        className="wf-container wf-implementation-section"
        aria-labelledby="implementation-title"
      >
        <div className="wf-implementation-card">
          <div>
            <span className="wf-eyebrow">UM COMEÇO ACOMPANHADO</span>
            <h2 id="implementation-title">
              Quer ajuda para colocar
              <br />a operação em ordem?
            </h2>
            <p>
              Converse sobre a implantação da Web Fidelize no seu negócio:
              serviços, profissionais, horários e página de agendamento
              organizados com você.
            </p>
            <Link className="wf-button" href="/diagnostico">
              Solicitar diagnóstico <Icon name="arrow-right" size={17} />
            </Link>
            <span className="wf-implementation-note">
              Escopo e investimento sob consulta. Sem contratação automática.
            </span>
          </div>
          <div className="wf-implementation-deliverables">
            <span>DA CONFIGURAÇÃO AO USO</span>
            <ul>
              <li>
                <Icon name="calendar" />
                <div>
                  <strong>Agenda e disponibilidade</strong>
                  <p>Configuração alinhada à sua rotina de atendimento.</p>
                </div>
              </li>
              <li>
                <Icon name="users" />
                <div>
                  <strong>Clientes, serviços e equipe</strong>
                  <p>
                    Orientação para organizar os cadastros e o acesso ao painel.
                  </p>
                </div>
              </li>
              <li>
                <Icon name="link" />
                <div>
                  <strong>Seu link pronto para compartilhar</strong>
                  <p>
                    Identidade e página pública dentro dos recursos disponíveis.
                  </p>
                </div>
              </li>
            </ul>
            <p>
              A proposta confirma as entregas. A implantação acompanhada é um
              serviço separado dos planos da plataforma.
            </p>
          </div>
        </div>
      </section>
      <section
        className="wf-container wf-section wf-pricing"
        id="planos"
        aria-labelledby="pricing-title"
      >
        <div className="wf-section-heading wf-heading-centered">
          <span className="wf-eyebrow">CRESÇA NO SEU RITMO</span>
          <h2 id="pricing-title">
            Um plano para cada
            <br />
            tamanho de agenda.
          </h2>
          <p>Os mesmos recursos essenciais. Espaço para diferentes equipes.</p>
          <Link href="/planos" className="wf-inline-link">
            Comparar planos e condições <Icon name="arrow-right" size={16} />
          </Link>
        </div>
        <div className="wf-plans-grid">
          {!plans && (
            <p role="status">
              Os preços estão indisponíveis no momento. Fale conosco pelo
              WhatsApp para consultar os planos.
            </p>
          )}
          {(plans || []).map((plan) => (
            <article
              className={`wf-plan ${plan.id === "profissional" ? "wf-plan-featured" : ""}`}
              key={plan.id}
            >
              {plan.id === "profissional" ? (
                <span className="wf-recommended">RECOMENDADO PARA EQUIPES</span>
              ) : null}
              <span className="wf-plan-kicker">
                {plan.staff === 1
                  ? "PARA QUEM ATENDE SOZINHO"
                  : plan.staff <= 3
                    ? "PARA UMA EQUIPE PEQUENA"
                    : "PARA MAIS PROFISSIONAIS"}
              </span>
              <h3>{plan.name}</h3>
              <div className="wf-price">
                {money(plan.cents)}
                <span>/mês</span>
              </div>
              <p className="wf-plan-capacity">
                Até{" "}
                <strong>
                  {plan.staff}{" "}
                  {plan.staff === 1 ? "profissional" : "profissionais"}
                </strong>{" "}
                na agenda
              </p>
              <ul>
                {[
                  "Agenda visual por dia e semana",
                  "Cadastro de clientes e serviços",
                  "Disponibilidade por profissional",
                  "Página pública de agendamento",
                  "Seu logotipo e 4 opções de cor",
                ].map((feature) => (
                  <li key={feature}>
                    <Icon name="check" />
                    {feature}
                  </li>
                ))}
              </ul>
              <TrialLink secondary={plan.id !== "profissional"} />
              <span className="wf-plan-trial-note">
                Teste de 7 dias no plano Essencial.
              </span>
            </article>
          ))}
        </div>
        <div className="wf-pricing-note">
          <Icon name="phone" />
          <div>
            <p>
              <strong>
                O teste é gratuito. A cobrança online ainda não está disponível.
              </strong>{" "}
              Os valores acima apresentam os planos previstos. Para conhecer a
              proposta para sua empresa,{" "}
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                fale no WhatsApp
              </a>
              .
            </p>
            <p>
              O proprietário ocupa uma vaga quando cadastrado como profissional
              na agenda. Nenhum cartão é solicitado no teste.
            </p>
          </div>
        </div>
      </section>
      <section
        className="wf-container wf-section wf-faq"
        id="duvidas"
        aria-labelledby="faq-title"
      >
        <div className="wf-section-heading">
          <span className="wf-eyebrow">ANTES DE COMEÇAR</span>
          <h2 id="faq-title">
            Dúvidas comuns.
            <br />
            Respostas diretas.
          </h2>
          <p>Entenda o que você pode fazer hoje com a Web Fidelize.</p>
        </div>
        <div className="wf-faq-grid">
          {questions.map(({ question, answer }) => (
            <details key={question}>
              <summary>
                {question}
                <Icon name="plus" size={17} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section
        className="wf-container wf-final-section"
        aria-labelledby="final-title"
      >
        <div className="wf-final-cta">
          <div>
            <span className="wf-eyebrow">
              MAIS ORGANIZAÇÃO PARA O SEU PRÓXIMO DIA
            </span>
            <h2 id="final-title">
              Seu próximo cliente
              <br />
              pode começar por um link.
            </h2>
            <p>
              Conheça a plataforma e veja como ela se encaixa na sua rotina.
            </p>
          </div>
          <div className="wf-final-actions">
            <TrialLink />
            <a
              className="wf-button wf-button-outline"
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="phone" />
              Falar no WhatsApp
            </a>
            <span>7 dias no Essencial · Sem cartão</span>
          </div>
        </div>
      </section>
      <footer className="wf-container wf-footer">
        <div>
          <Brand href="/" className="wf-brand" />
          <p>
            Agenda, clientes e profissionais.
            <br />
            Conectados à sua rotina.
          </p>
        </div>
        <div className="wf-footer-links">
          <a href="#recursos">Recursos</a>
          <a href="#planos">Planos</a>
          <Link href="/diagnostico">Implantação acompanhada</Link>
          <a href="#duvidas">Dúvidas</a>
          <Link href="/entrar">Entrar na minha conta</Link>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        </div>
        <div className="wf-footer-bottom">
          <span>© {new Date().getFullYear()} Web Fidelize</span>
          <span>Feito para pequenos negócios.</span>
        </div>
      </footer>
    </main>
  );
}
