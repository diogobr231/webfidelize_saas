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
    "Compare preços, limites de profissionais e benefícios da Web Fidelize. Experimente uma demonstração antes de escolher seu plano.",
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
            planos. Compare o espaço para profissionais e os recursos de análise
            para acompanhar o crescimento da sua equipe.
          </p>
          <p>
            <strong>7 dias grátis no Essencial</strong>, com cartão autorizado.
            Ativação em preparação. <a href="#condicoes-teste">Ver condições</a>
            .
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
            Explore a agenda e a ficha de um cliente com{" "}
            <strong>dados de exemplo</strong>.
          </p>
          <div>
            <span>
              <Icon name="check" size={15} /> Sem login
            </span>
            <span>
              <Icon name="check" size={15} /> Sem cartão
            </span>
          </div>
          <Link className="button" href="/demonstracao">
            Experimentar demonstração <Icon name="arrow-right" size={16} />
          </Link>
          <small>
            A demonstração não cria reservas reais nem inicia um período de
            assinatura.
          </small>
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
            O núcleo de agenda e atendimento está em todos os planos. Os
            indicadores da equipe e a exportação ajudam quando sua operação
            precisa de mais acompanhamento.
          </p>
        </div>
        <div className="plans-answers">
          <details>
            <summary>
              O que muda além do número de profissionais?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              Todos os planos incluem o Meu dia para colaboradores vinculados,
              com agenda pessoal, confirmações registradas e conclusão dos
              próprios atendimentos após o horário. O Profissional inclui
              indicadores de equipe com consultas de até 31 dias. O Empresarial
              amplia o período para até 90 dias e permite exportar os
              indicadores em CSV. Esses relatórios são operacionais e não
              representam receita.
            </p>
          </details>
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
              Como funcionam os 7 dias grátis?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              O teste de 7 dias grátis é no Essencial, com 1 profissional. O
              cartão é obrigatório e a contagem começa somente após sua
              confirmação pelo Mercado Pago. A primeira mensalidade será cobrada
              depois do teste, com renovação mensal. Cancelar antes do fim do
              teste evita a primeira cobrança. A ativação ainda está em
              preparação; o cadastro da conta e da empresa não inicia o teste.
            </p>
          </details>
          <details>
            <summary>
              Como funciona a contratação?
              <Icon name="plus" size={18} />
            </summary>
            <p>
              A cobrança online ainda não está disponível. O cadastro do cartão
              será feito no ambiente seguro do Mercado Pago. Enquanto essa
              integração estiver em configuração, novos testes ficam com a
              ativação pendente. Fale pelo WhatsApp para consultar as condições;
              entrar em contato não ativa uma assinatura nem altera o plano da
              sua empresa.
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
