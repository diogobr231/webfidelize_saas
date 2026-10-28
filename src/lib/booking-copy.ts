export const bookingCopyByNiche: Record<
  string,
  { headline: string; description: string; servicePrompt: string }
> = {
  salao: {
    headline: "Seu momento de cuidado, no melhor horário.",
    description:
      "Escolha o serviço e quem vai atender você. O salão recebe sua reserva diretamente na agenda.",
    servicePrompt: "Qual serviço você deseja agendar?",
  },
  "pet-shop": {
    headline: "Um horário especial para o seu pet.",
    description:
      "Escolha o cuidado, informe os dados básicos do seu pet e encontre um horário disponível.",
    servicePrompt: "De qual cuidado seu pet precisa?",
  },
  clinica: {
    headline: "Agende seu atendimento com praticidade.",
    description:
      "Escolha o tipo de atendimento, o profissional e um horário. A recepção recebe sua reserva.",
    servicePrompt: "Qual tipo de atendimento você procura?",
  },
  escritorio: {
    headline: "Vamos marcar sua próxima conversa.",
    description:
      "Escolha o tipo de reunião, quem vai atender você e um horário disponível.",
    servicePrompt: "Qual tipo de atendimento ou reunião?",
  },
  fornecedores: {
    headline: "Organize seu próximo atendimento ou entrega.",
    description:
      "Escolha o serviço e compartilhe um endereço ou link do Google Maps, se for necessário.",
    servicePrompt: "O que você precisa agendar?",
  },
  logistica: {
    headline: "Combine o atendimento no local certo.",
    description:
      "Escolha o serviço e, se necessário, informe o endereço ou link do Google Maps.",
    servicePrompt: "Qual serviço você deseja agendar?",
  },
  restaurante: {
    headline: "Escolha um horário para seu atendimento.",
    description:
      "Consulte os serviços e horários disponíveis. Reservas de mesas ainda não estão incluídas.",
    servicePrompt: "Qual serviço você deseja agendar?",
  },
  academia: {
    headline: "Encontre o horário que combina com você.",
    description:
      "Agende um atendimento individual ou confira as turmas com vagas disponíveis.",
    servicePrompt: "Qual atendimento individual você deseja?",
  },
};

export function bookingCopy(niche: string) {
  return (
    bookingCopyByNiche[niche] ?? {
      headline: "Reserve seu próximo horário.",
      description:
        "Escolha o serviço e encontre um horário disponível na agenda da empresa.",
      servicePrompt: "Escolha seu serviço",
    }
  );
}
