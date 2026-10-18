import Link from "next/link";
import type { ReactNode } from "react";
import { setupProgress, type SetupStep } from "@/lib/onboarding";
import { niches } from "@/lib/catalog";
import { Icon } from "@/components/ui/icon";
import "./onboarding.css";

const stepContent: Record<
  SetupStep,
  { eyebrow: string; title: string; description: string }
> = {
  empresa: {
    eyebrow: "PRIMEIRO, O SEU NEGÓCIO",
    title: "Seu espaço começa aqui.",
    description:
      "Dê um nome à sua empresa e escolha seu segmento. Vamos organizar a configuração em passos simples.",
  },
  servicos: {
    eyebrow: "AGORA, O QUE VOCÊ OFERECE",
    title: "O que seu cliente pode agendar?",
    description:
      "Cadastre um primeiro serviço com a duração e o preço que você pratica. Depois, você pode adicionar outros.",
  },
  equipe: {
    eyebrow: "QUEM FAZ O ATENDIMENTO ACONTECER",
    title: "Vamos conhecer seu profissional.",
    description:
      "Cadastre quem vai receber os agendamentos. Pode ser você ou uma pessoa da sua equipe.",
  },
  resumo: {
    eyebrow: "UM PASSO DE CADA VEZ",
    title: "Revise sua configuração.",
    description:
      "Confira o que já está salvo e veja os próximos passos para começar a receber agendamentos.",
  },
};

const steps: { id: SetupStep; name: string; hint: string }[] = [
  { id: "empresa", name: "Sua empresa", hint: "Nome e segmento" },
  { id: "servicos", name: "Seus serviços", hint: "Duração e preço" },
  { id: "equipe", name: "Seu profissional", hint: "Quem vai atender" },
];

export function OnboardingFrame({
  current,
  company,
  services,
  professionals,
  children,
}: {
  current: SetupStep;
  company?: { id: string; name: string; niche: string };
  services: number;
  professionals: number;
  children: ReactNode;
}) {
  const progress = setupProgress(Boolean(company), services, professionals);
  const content = stepContent[current];
  const niche = niches.find((item) => item.slug === company?.niche);
  const pauseHref = company
    ? `/painel/${company.id}?configuracao=pausada`
    : "/painel?empresas=1";
  return (
    <section className="onb-page" aria-labelledby="onb-title">
      <div className="onb-container">
        <header className="onb-header">
          <span className="onb-header-label">
            <Icon name="layout" size={18} />
            Primeiros passos
          </span>
          <Link
            href={pauseHref}
            className="onb-pause-link"
            aria-describedby="onb-pause-hint"
          >
            Continuar depois <Icon name="arrow-up-right" size={16} />
          </Link>
        </header>
        <div className="onb-intro">
          <div>
            <span className="onb-eyebrow">CONFIGURAÇÃO INICIAL</span>
            <p>
              {company
                ? company.name
                : "Um começo organizado para a sua empresa."}
            </p>
          </div>
          <p className="onb-note" id="onb-pause-hint">
            Ao sair, apenas as etapas já salvas são mantidas.
          </p>
        </div>
        <nav className="onb-progress-nav" aria-label="Etapas da configuração">
          <ol>
            {steps.map((step, index) => {
              const complete = progress.completed[index];
              const available =
                Boolean(company) &&
                (index < 2 || services > 0 || professionals > 0);
              const contents = (
                <>
                  <span className="onb-step-marker" aria-hidden="true">
                    {complete ? <Icon name="check" size={16} /> : index + 1}
                  </span>
                  <span className="onb-step-copy">
                    <strong>{step.name}</strong>
                    <span>{complete ? "Etapa salva" : step.hint}</span>
                  </span>
                  {current === step.id ? (
                    <span className="onb-step-current">Agora</span>
                  ) : null}
                </>
              );
              return (
                <li
                  key={step.id}
                  data-complete={complete}
                  data-current={current === step.id}
                >
                  {available ? (
                    <Link
                      href={`/painel/${company!.id}/configuracao?etapa=${step.id}`}
                      aria-current={current === step.id ? "step" : undefined}
                    >
                      {contents}
                    </Link>
                  ) : (
                    <div
                      aria-current={current === step.id ? "step" : undefined}
                    >
                      {contents}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="onb-layout">
          <div className="onb-main">
            <header className="onb-title">
              <span className="onb-eyebrow">{content.eyebrow}</span>
              <h1 id="onb-title">{content.title}</h1>
              <p>{content.description}</p>
            </header>
            {children}
          </div>
          <aside className="onb-context" aria-label="Progresso salvo">
            <div className="onb-context-header">
              <span className="onb-context-icon" aria-hidden="true">
                <Icon name="check" size={20} />
              </span>
              <span>O que já está salvo</span>
            </div>
            <div className="onb-progress-count">
              <strong>
                {progress.done}
                <span> de {progress.total}</span>
              </strong>
              <span>etapas de cadastro concluídas</span>
            </div>
            <div
              className="onb-progress-track"
              role="progressbar"
              aria-label="Progresso dos cadastros iniciais"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${progress.done} de ${progress.total} etapas salvas`}
            >
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <dl className="onb-saved-details">
              <div>
                <dt>Empresa</dt>
                <dd>{company?.name || "Ainda não cadastrada"}</dd>
                {company && niche ? (
                  <dd className="onb-saved-niche">{niche.name}</dd>
                ) : null}
              </div>
              <div>
                <dt>Serviços</dt>
                <dd>
                  {services}{" "}
                  {services === 1
                    ? "serviço cadastrado"
                    : "serviços cadastrados"}
                </dd>
              </div>
              <div>
                <dt>Profissionais</dt>
                <dd>
                  {professionals}{" "}
                  {professionals === 1
                    ? "profissional cadastrado"
                    : "profissionais cadastrados"}
                </dd>
              </div>
            </dl>
            <p className="onb-context-note">
              Cada etapa confirmada fica salva na sua conta. Você pode voltar
              para continuar a configuração.
            </p>
            {company ? (
              <Link href={`/painel/${company.id}`} className="onb-context-link">
                Abrir painel da empresa <Icon name="arrow-right" size={16} />
              </Link>
            ) : null}
            <div className="onb-context-next">
              <strong>E depois?</strong>
              <p>
                Configure a disponibilidade e habilite sua página pública quando
                estiver pronto para receber reservas.
              </p>
            </div>
          </aside>
        </div>
        <footer className="onb-footer">
          <span>Web Fidelize · Um passo de cada vez.</span>
          <span>Seus dados pertencem à sua empresa.</span>
        </footer>
      </div>
    </section>
  );
}
