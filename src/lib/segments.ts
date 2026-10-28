import { niches } from "./catalog";

const content = {
  academia: {
    headline: "Uma turma, várias vagas e uma agenda organizada.",
    description:
      "Organize aulas e atendimentos individuais com controle de vagas, participantes e inscrições online.",
    services: [
      "Aula de exemplo",
      "Avaliação de exemplo",
      "Atendimento de exemplo",
    ],
    features: [
      "Turmas com limite de vagas e inscrições online",
      "Presença dos participantes e agenda individual",
      "Fichas de treino em texto e validade dos planos dos alunos",
    ],
    limitation:
      "Não há integração com catraca nem cobrança automática de mensalidades.",
  },
  salao: {
    headline:
      "Mais cuidado com suas clientes. Menos tempo organizando horários.",
    description:
      "Organize os atendimentos do salão, da manicure e de cada profissional. Compartilhe uma página de reservas com a identidade do seu espaço.",
    services: ["Manicure", "Corte de cabelo", "Escova"],
    features: [
      "Agenda individual por profissional e reservas online",
      "Comissões e movimentos de caixa registrados manualmente",
      "Controle de quantidade do estoque",
    ],
    limitation:
      "Comissões e movimentações são manuais; não há integração com maquininha ou contabilidade.",
  },
  "pet-shop": {
    headline: "Uma agenda organizada para quem cuida dos pets.",
    description:
      "Reúna os horários de atendimento, os contatos dos clientes e os serviços do seu pet shop. Deixe o próximo agendamento começar pelo seu link.",
    services: ["Banho", "Tosa", "Atendimento de orientação"],
    features: [
      "Cadastro de pets e tutores ligado aos atendimentos",
      "Serviços, agenda e histórico de atendimentos",
      "Controle de quantidade do estoque",
    ],
    limitation: "Não inclui diagnóstico nem prontuário clínico veterinário.",
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
    features: [
      "Agenda por profissional e página de agendamento",
      "Recepção com serviços, clientes e histórico de horários",
      "Acesso da equipe conforme as permissões da empresa",
    ],
    limitation: "Não inclui prontuário, diagnóstico nem informações clínicas.",
  },
  escritorio: {
    headline: "Seus clientes e compromissos, no mesmo lugar.",
    description:
      "Organize reuniões e atendimentos, consulte o histórico e dê à sua equipe uma visão clara dos próximos compromissos.",
    services: ["Reunião inicial", "Atendimento", "Acompanhamento"],
    features: [
      "Agenda de compromissos e histórico de clientes",
      "Tarefas com etapas e processos acompanháveis",
      "Links HTTPS para documentos armazenados no serviço escolhido pela empresa",
    ],
    limitation:
      "A Web Fidelize guarda links HTTPS de documentos, não os arquivos. O armazenamento fica no serviço escolhido pela empresa.",
  },
  restaurante: {
    headline: "Mesas, comandas e pedidos com etapas mais claras.",
    description:
      "Registre mesas e capacidade, acompanhe as etapas dos pedidos e lance movimentações de caixa em um painel da empresa.",
    services: ["Pedido no salão", "Retirada", "Atendimento"],
    features: [
      "Cadastro de mesas e capacidade",
      "Comandas com etapa do pedido, tempo de abertura e impressão",
      "Movimentações de caixa registradas manualmente",
    ],
    limitation:
      "O caixa é manual. Não há integração com PDV ou maquininha nem reserva automática de mesas pela página pública.",
  },
  fornecedores: {
    headline: "Pedidos e entregas com etapas acompanháveis.",
    description:
      "Organize pedidos para fornecedores, acompanhe o recebimento e compartilhe entregas com localização do Google Maps.",
    services: ["Entrega", "Retirada", "Atendimento"],
    features: [
      "Pedidos a fornecedores do pedido ao recebimento",
      "Entregas com etapas de acompanhamento",
      "Endereços e localização compartilhados por link do Google Maps",
    ],
    limitation:
      "A localização usa links do Google Maps; não há cálculo automático de rotas.",
  },
  logistica: {
    headline: "Entregadores, rotas e entregas em um só fluxo.",
    description:
      "Cadastre entregadores, organize rotas e acompanhe cada entrega até a conclusão, com links para o Google Maps.",
    services: ["Coleta", "Entrega local", "Rota agendada"],
    features: [
      "Cadastro de entregadores e disponibilidade",
      "Rotas e entregas com etapas de acompanhamento",
      "Links de localização do Google Maps",
    ],
    limitation: "Não otimiza rotas nem transmite localização em tempo real.",
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
        features: [
          "Agenda individual, clientes e serviços",
          "Página de agendamento com a identidade da empresa",
          "Equipe e permissões conforme o plano contratado",
        ],
        limitation:
          "Módulos especializados para esse segmento estão em planejamento. A demonstração cobre o núcleo de agenda, clientes e serviços.",
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
