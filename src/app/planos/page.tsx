import Link from "next/link";
import { commercialPlans } from "@/lib/commercial";
import { Brand } from "@/components/ui/brand";
import { Icon } from "@/components/ui/icon";
import { PlansComparison } from "@/components/plans-comparison";
import { site } from "@/lib/seo";
import "./plans-public.css";
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
  const whatsapp =
    "https://wa.me/5518997695445?text=Ol%C3%A1!%20Quero%20entender%20qual%20plano%20da%20Web%20Fidelize%20combina%20com%20minha%20empresa.";
  return (
    <main className="plans-public">
      <a className="plans-skip" href="#comparar">
        Pular para os planos
      </a>
      <nav aria-label="Navegação da página de planos">
        <Brand />
        <Link className="plans-back" href="/#recursos">
          Conhecer os recursos
        </Link>
        <Link className="button secondary" href="/entrar">
          Entrar
        </Link>
      </nav>
      <header className="plans-hero">
        <div>
          <span className="plans-eyebrow">O ESSENCIAL PARA ATENDER BEM</span>
          <h1>
            Uma rotina organizada.
            <br />
            <em>Um plano do seu tamanho.</em>
          </h1>
          <p>
            Agenda, clientes, serviços e seu link de agendamento em todos os
            planos. Compare o espaço para os profissionais que atendem na sua
            empresa.
          </p>
          <a
            className="plans-contact"
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="phone" size={17} /> Converse sobre o seu negócio{" "}
            <Icon name="arrow-up-right" size={15} />
          </a>
        </div>
        <aside className="plans-trial-card" aria-labelledby="trial-title">
          <span className="plans-trial-icon">
            <Icon name="calendar" size={23} />
          </span>
          <h2 id="trial-title">Conheça antes de escolher.</h2>
          <p>
            Teste grátis por <strong>7 dias no Essencial</strong>, com 1
            profissional na agenda.
          </p>
          <div>
            <span>
              <Icon name="check" size={15} /> Sem cartão
            </span>
            <span>
              <Icon name="check" size={15} /> Sem cobrança automática
            </span>
          </div>
          <Link className="button" href="/cadastro">
            Testar grátis por 7 dias <Icon name="arrow-right" size={16} />
          </Link>
          <small>O período começa quando você cria a empresa.</small>
        </aside>
      </header>
      <section
        className="plans-selection"
        id="comparar"
        aria-labelledby="comparison-title"
      >
        <div className="plans-comparison-heading">
          <div>
            <span className="plans-eyebrow">COMPARE OS PLANOS</span>
            <h2 id="comparison-title">Quanto espaço sua agenda precisa?</h2>
          </div>
          <span>Valores mensais configurados na plataforma</span>
        </div>
        <PlansComparison plans={plans} />
      </section>
      <section className="plans-explained" aria-labelledby="plan-guide-title">
        <div>
          <span className="plans-eyebrow">ESCOLHA COM CLAREZA</span>
          <h2 id="plan-guide-title">
            O que considerar
            <br />
            antes de começar.
          </h2>
          <p>
            O tamanho da equipe muda. O núcleo de agenda e atendimento está em
            todos os planos.
          </p>
        </div>
        <div className="plans-answers">
          <details>
            <summary>
              Quem ocupa uma vaga no plano?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              Cada profissional ativo cadastrado para receber agendamentos ocupa
              uma vaga. O proprietário também conta quando atende. Um convite
              para acessar o painel é diferente do cadastro de um profissional
              na agenda.
            </p>
          </details>
          <details>
            <summary>
              Meu cliente precisa pagar ou instalar algo?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              Ele acessa sua página pelo navegador e escolhe um horário
              disponível, sem criar conta. O fluxo de reserva não cobra pelo
              atendimento: valores e pagamento do serviço são combinados
              diretamente com a sua empresa.
            </p>
          </details>
          <details>
            <summary>
              O teste começa em qual plano?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              Todos os botões de teste iniciam o mesmo fluxo: cadastro da conta
              e criação da empresa no Essencial, com 1 profissional. A contagem
              de 7 dias começa ao criar a empresa e não há cobrança automática.
            </p>
          </details>
          <details>
            <summary>
              Como funciona a contratação?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              A cobrança online ainda não está disponível. Os preços exibidos
              apresentam os planos previstos. Fale pelo WhatsApp para consultar
              as condições; entrar em contato não ativa uma assinatura nem
              altera o plano da sua empresa.
            </p>
          </details>
        </div>
      </section>
      <footer className="plans-footer">
        <Link href="/">
          Voltar à Web Fidelize <Icon name="arrow-right" size={16} />
        </Link>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer">
          <Icon name="phone" size={16} /> Falar no WhatsApp
        </a>
      </footer>
    </main>
  );
}
