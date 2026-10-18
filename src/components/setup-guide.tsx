import Link from "next/link";
import { setupProgress } from "@/lib/onboarding";

type SetupStep = {
  label: string;
  description: string;
  href: string;
  done: boolean;
  available: boolean;
};

export function SetupGuide({
  companyId,
  services,
  professionals,
  shifts,
  published,
  owner,
  writable,
}: {
  companyId: string;
  services: number;
  professionals: number;
  shifts: number;
  published: boolean;
  owner: boolean;
  writable: boolean;
}) {
  const base = `/painel/${companyId}`;
  const steps: SetupStep[] = [
    {
      label: "Cadastre seus serviços",
      description: "Defina duração e valor de cada atendimento.",
      href: `${base}/services`,
      done: services > 0,
      available: true,
    },
    {
      label: "Adicione os profissionais",
      description: "Quem vai atender seus clientes?",
      href: `${base}/professionals`,
      done: professionals > 0,
      available: true,
    },
    {
      label: "Confira os horários",
      description: "Ajuste os turnos e os intervalos da semana.",
      href: `${base}/disponibilidade#turnos`,
      done: shifts > 0,
      available: true,
    },
    {
      label: "Publique sua página",
      description: owner
        ? "Personalize e compartilhe seu endereço de reservas."
        : "O proprietário publica o link para seus clientes.",
      href: `${base}/disponibilidade#pagina-publica`,
      done: published,
      available: owner,
    },
  ];
  const done = steps.filter((step) => step.done).length;
  const initialSetup = setupProgress(true, services, professionals);
  return (
    <section className="panel setup-guide" aria-labelledby="setup-title">
      <div className="workspace-section-heading">
        <div>
          <span className="tag">Preparar agendamento online</span>
          <h3 id="setup-title">
            {!writable
              ? "Sua configuração está salva"
              : done === 4
                ? "Sua empresa já pode receber reservas"
                : "Sua primeira reserva começa aqui"}
          </h3>
        </div>
        <span className="setup-count">{done} de 4</span>
      </div>
      <progress
        aria-label="Etapas da configuração concluídas"
        max={4}
        value={done}
      />
      <ol className="setup-steps">
        {steps.map((step, index) => (
          <li key={step.label} className={step.done ? "is-complete" : ""}>
            <span
              className="setup-step-number"
              aria-label={step.done ? "Concluída" : `Etapa ${index + 1}`}
            >
              {step.done ? "✓" : index + 1}
            </span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.description}</p>
            </div>
            {step.available ? (
              <Link href={step.href}>
                {step.done ? "Revisar" : "Começar"}
                <span aria-hidden="true"> →</span>
                <span className="workspace-sr-only">: {step.label}</span>
              </Link>
            ) : (
              <span className="muted">Proprietário</span>
            )}
          </li>
        ))}
      </ol>
      <p className="setup-footnote">
        {!writable &&
          "Regularize sua assinatura para voltar a receber reservas. "}
        O progresso acompanha os cadastros salvos. Profissionais começam com
        horários de segunda a sexta, das 8h às 18h; revise para refletir seu
        atendimento.
      </p>
      <div className="workspace-actions">
        <Link
          className="button secondary"
          href={`${base}/configuracao?etapa=${initialSetup.next}`}
        >
          {services > 0 && professionals > 0
            ? "Revisar configuração guiada"
            : "Continuar configuração guiada"}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <p className="setup-footnote">
        O guia inicial organiza empresa, serviços e profissionais para uso
        interno. Somente os cadastros salvos contam para o progresso. A página
        pública é ativada separadamente pelo proprietário.
      </p>
    </section>
  );
}
