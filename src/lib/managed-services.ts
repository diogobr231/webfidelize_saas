export const managedServices = [
  {
    id: "agenda",
    slug: "web-fidelize",
    title: "Agenda personalizada",
    icon: "calendar" as const,
    summary:
      "O cliente agenda no seu link. A reserva entra na agenda da sua empresa no SaaS.",
    scope: [
      "Página com a identidade do negócio",
      "Serviços, profissionais e horários",
      "Clientes e atendimentos no painel",
    ],
    request:
      "Quero configurar a agenda personalizada da minha empresa na Web Fidelize.",
  },
  {
    id: "conteudo",
    slug: "conteudo-gerenciado",
    title: "Conteúdo para redes sociais",
    icon: "sparkles" as const,
    summary:
      "Envie as fotos e deixe o calendário, as legendas e a preparação dos posts com a gente.",
    scope: [
      "Até 30 posts de imagem por mês",
      "Instagram e Facebook com o mesmo conteúdo",
      "Legendas, até 5 hashtags e 1 rodada de ajustes",
      "Foto do cliente ou arte acordada, com revisão humana",
    ],
    request:
      "Quero conteúdo gerenciado: até 30 posts por mês. Vou combinar fotos próprias ou produção de arte, redes e calendário na proposta.",
  },
  {
    id: "trafego",
    slug: "trafego-gerenciado",
    title: "Gestão de tráfego pago",
    icon: "briefcase" as const,
    summary:
      "Campanhas com objetivo, destino e investimento combinados antes de começar.",
    scope: [
      "1 conta Meta Ads · Instagram/Facebook",
      "Gestão para verba de até R$ 1.500/mês",
      "1 campanha inicial e acompanhamento semanal",
      "Verba de mídia paga à parte pelo cliente",
    ],
    request:
      "Quero gestão de tráfego Meta. Minha verba de anúncios será definida separadamente da mensalidade de gestão.",
  },
  {
    id: "fotografia",
    slug: "fotografia-mensal",
    title: "Fotografia no seu negócio",
    icon: "camera" as const,
    summary:
      "Uma visita por mês de um parceiro local, contratado pela Web Fidelize após confirmar sua região.",
    scope: [
      "1 visita mensal de até 1 hora",
      "15 fotos selecionadas e tratadas",
      "Data, deslocamento e parceiro sob confirmação",
      "Atendimento em diferentes cidades mediante orçamento",
    ],
    request:
      "Quero uma visita mensal de fotógrafo parceiro. Cidade/UF: ____. Data desejada: ____. A visita depende de disponibilidade e orçamento local.",
  },
] as const;
export function serviceRequest(slug: string | undefined) {
  if (slug === "gestao-digital-combo")
    return "Quero o combo de conteúdo e gestão de tráfego: até 30 posts/mês e 1 conta Meta Ads. Verba de mídia, assinatura do SaaS e fotografia serão discriminadas na proposta. Cidade/UF: ____.";
  return managedServices.find((item) => item.slug === slug)?.request ?? "";
}
