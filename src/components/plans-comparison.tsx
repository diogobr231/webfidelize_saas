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
                  href="/cadastro"
                >
                  Testar grátis por 7 dias
                </Link>
              )}
              <p className="plan-caption">
                {authenticated
                  ? "O contato não altera seu plano nem ativa cobrança."
                  : "7 dias no Essencial, com 1 profissional. Cartão obrigatório; ativação em preparação."}
              </p>
            </article>
          ))}
        </div>
      )}
      <div className="plan-conditions">
        <Icon name="shield" size={22} />
        <div>
          <h3>Condições claras, desde o primeiro dia</h3>
          <p>
            Os 7 dias de teste exigem cartão cadastrado e autorizado no Mercado
            Pago. O período começa somente após a confirmação do cartão. A
            primeira mensalidade será cobrada apenas depois dos 7 dias, com
            renovação mensal pelo valor do plano contratado. Cancelar antes do
            fim do teste evita a primeira cobrança.
          </p>
          <p>
            A cobrança online pelo Mercado Pago e a ativação de novos testes
            ainda estão em preparação. Criar a empresa agora não inicia o teste
            nem gera cobrança. O proprietário ocupa uma vaga quando também
            atende; cadastrar um profissional é diferente de convidar alguém
            para acessar o painel. Recursos específicos de nicho, IA, caixa e
            mensagens automáticas não estão incluídos nesta versão.
          </p>
        </div>
      </div>
    </section>
  );
}
