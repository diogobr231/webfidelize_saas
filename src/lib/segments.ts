import { niches } from "./catalog";

const content = {
  salao: {
    headline:
      "Mais cuidado com suas clientes. Menos tempo organizando horários.",
    description:
      "Organize os atendimentos do salão, da manicure e de cada profissional. Compartilhe uma página de reservas com a identidade do seu espaço.",
    services: ["Manicure", "Corte de cabelo", "Escova"],
    limitation: "Comissões, caixa e estoque não fazem parte do módulo atual.",
  },
  "pet-shop": {
    headline: "Uma agenda organizada para quem cuida dos pets.",
    description:
      "Reúna os horários de atendimento, os contatos dos clientes e os serviços do seu pet shop. Deixe o próximo agendamento começar pelo seu link.",
    services: ["Banho", "Tosa", "Atendimento de orientação"],
    limitation:
      "Cadastro individual de pets, prontuário veterinário e estoque ainda não estão disponíveis.",
  },
  clinica: {
    headline: "Recepção organizada. Mais clareza para cada atendimento.",
    description:
      "Veja os horários de cada profissional, mantenha os contatos organizados e receba solicitações de agendamento pela página da clínica.",
    services: [
      "Consulta de exemplo",
      "Retorno de exemplo",
      "Avaliação de exemplo",
    ],
    limitation:
      "A plataforma organiza a recepção e os horários. Não inclui prontuário, diagnóstico ou informações clínicas.",
  },
  escritorio: {
    headline: "Seus clientes e compromissos, no mesmo lugar.",
    description:
      "Organize reuniões e atendimentos, consulte o histórico e dê à sua equipe uma visão clara dos próximos compromissos.",
    services: ["Reunião inicial", "Atendimento", "Acompanhamento"],
    limitation:
      "Gestão de tarefas, documentos e processos específicos não está incluída no módulo atual.",
  },
} as const;
export function segmentBySlug(slug: string) {
  const niche = niches.find((item) => item.slug === slug);
  if (!niche) return null;
  const available = Object.hasOwn(content, niche.slug);
  const details = available
    ? content[niche.slug as keyof typeof content]
    : {
        headline: `Agenda e clientes para ${niche.name.toLowerCase()}.`,
        description: `Explore como organizar contatos e horários de atendimento em ${niche.name.toLowerCase()}. Experimente o núcleo de agenda, clientes e serviços na demonstração.`,
        services: [
          "Atendimento de exemplo",
          "Reunião de exemplo",
          "Orientação de exemplo",
        ],
        limitation:
          niche.description +
          " A demonstração apresenta somente o núcleo de agendamentos, sem simular esses módulos.",
      };
  return { ...niche, ...details, available };
}

export const demoClients = [
  "Gabriela · exemplo",
  "Marina · exemplo",
  "Rafael · exemplo",
] as const;
export const demoProfessionals = [
  "Daniela · exemplo",
  "Alex · exemplo",
] as const;
export const demoTimes = [
  "09:00",
  "10:00",
  "11:00",
  "14:00",
  "15:00",
  "16:00",
] as const;
export type DemoAppointment = {
  id: string;
  client: string;
  professional: string;
  service: string;
  time: string;
};
export function createDemoAppointment(
  appointments: DemoAppointment[],
  input: Omit<DemoAppointment, "id">,
  services: readonly string[],
): { error: string } | { appointments: DemoAppointment[] } {
  if (
    !demoClients.some((value) => value === input.client) ||
    !demoProfessionals.some((value) => value === input.professional) ||
    !demoTimes.some((value) => value === input.time) ||
    !services.includes(input.service)
  )
    return { error: "Escolha as opções de exemplo disponíveis." };
  if (
    appointments.some(
      (item) =>
        item.professional === input.professional && item.time === input.time,
    )
  )
    return {
      error:
        "Este profissional já tem um atendimento neste horário. Experimente outro horário.",
    };
  return {
    appointments: [
      ...appointments,
      { ...input, id: `${input.professional}-${input.time}` },
    ].sort((a, b) => a.time.localeCompare(b.time)),
  };
}
