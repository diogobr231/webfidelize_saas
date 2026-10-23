import Link from "next/link";
import { money } from "@/lib/catalog";
import type { CommercialPlan } from "@/lib/commercial";
import { teamPlanBenefits } from "@/lib/plan-benefits";
import { Icon } from "./ui/icon";
import "./plans-comparison.css";

const features = [
  "Agenda visual diária e semanal",
  "Clientes e catálogo de serviços",
  "Turnos e intervalos por profissional",
  "Página pública de agendamento",
  "Turmas com limite de vagas e inscrição online",
  "Importação de agenda por ICS ou CSV",
  "Configuração guiada e central de ajuda",
];
export function PlansComparison({
  plans,
  current,
  authenticated = false,
  owner = false,
}: {
  plans: CommercialPlan[] | null;
  current?: string;
  authenticated?: boolean;
  owner?: boolean;
}) {
  return (
    <section className="plans-comparison" aria-label="Comparação de planos">
      {!plans ? (
        <div className="notice error" role="alert">
          Não foi possível consultar os planos agora. Atualize a página ou fale
          com o suporte.
        </div>
      ) : (
        <div className="plan-options">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={`plan-option ${plan.id === "profissional" ? "is-recommended" : ""}`}
            >
              <div className="plan-flags">
                {plan.id === "profissional" && (
                  <span>Recomendado para equipes</span>
                )}
                {plan.id === current && <strong>Seu plano atual</strong>}
              </div>
              <h2>{plan.name}</h2>
              <p className="plan-price">
                {money(plan.cents)} <small>/mês</small>
              </p>
              <p>
                <strong>
                  Até {plan.staff}{" "}
                  {plan.staff === 1 ? "profissional" : "profissionais"}
                </strong>{" "}
                na agenda
              </p>
              <ul>
                {[...features, ...teamPlanBenefits(plan)].map((feature) => (
                  <li key={feature}>
                    <Icon name="check" size={16} />
                    {feature}
                  </li>
                ))}
              </ul>
              {authenticated ? (
                owner ? (
                  <a
                    className={`button ${plan.id === "profissional" ? "" : "secondary"}`}
                    href={`https://wa.me/5518997695445?text=${encodeURIComponent(`Olá! Quero informações sobre o plano ${plan.name} da Web Fidelize, de ${money(plan.cents)} por mês.`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Falar sobre este plano{" "}
                    <Icon name="arrow-up-right" size={16} />
                  </a>
                ) : (
                  <p className="plan-caption">
                    A contratação é gerenciada pelo proprietário.
                  </p>
                )
              ) : (
                <Link
                  className={`button ${plan.id === "profissional" ? "" : "secondary"}`}
                  href="/demonstracao"
                >
                  Experimentar demonstração
                </Link>
              )}
              <p className="plan-caption">
                {authenticated
                  ? "O contato não altera seu plano nem ativa cobrança."
                  : "Demonstração com dados de exemplo, sem login e sem cartão."}
              </p>
            </article>
          ))}
        </div>
      )}
      <div className="plan-conditions" id="condicoes-teste">
        <Icon name="shield" size={22} />
        <div>
          <h3>7 dias grátis para conhecer sua rotina no sistema</h3>
          <p>
            Os 7 dias grátis no Essencial, com 1 profissional, exigem cartão
            cadastrado e autorizado no Mercado Pago. O período começa somente
            após a confirmação do cartão pelo provedor. A primeira mensalidade
            será cobrada apenas depois dos 7 dias, com renovação mensal pelo
            valor do plano contratado. Cancelar antes do fim do teste evita a
            primeira cobrança.
          </p>
          <p>
            A cobrança online pelo Mercado Pago e a ativação de novos testes
            ainda estão em preparação. Criar a empresa agora não inicia o teste
            nem gera cobrança. O proprietário ocupa uma vaga quando também
            atende; cadastrar um profissional é diferente de convidar alguém
            para acessar o painel. Recursos específicos de nicho, IA, caixa e
            chatbot não estão incluídos nesta versão. Os avisos de WhatsApp
            dependem de configuração e cota próprias.
          </p>
          {!authenticated && (
            <Link className="button secondary" href="/cadastro">
              Preparar meu cadastro <Icon name="arrow-right" size={16} />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
