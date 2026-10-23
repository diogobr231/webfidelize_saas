export const niches = [
  {
    slug: "salao",
    name: "Salão e manicure",
    icon: "✂",
    color: "#f472b6",
    description: "Mais horários preenchidos. Mais tempo para cuidar.",
  },
  {
    slug: "pet-shop",
    name: "Pet shop",
    icon: "♧",
    color: "#2dd4bf",
    description: "Uma rotina organizada para quem cuida dos pets.",
  },
  {
    slug: "clinica",
    name: "Clínica e consultório",
    icon: "✚",
    color: "#38bdf8",
    description: "Agendamentos e recepção em um só lugar.",
  },
  {
    slug: "escritorio",
    name: "Escritório",
    icon: "▤",
    color: "#a78bfa",
    description: "Clientes e compromissos sempre por perto.",
  },
  {
    slug: "restaurante",
    name: "Restaurante",
    icon: "♨",
    color: "#fb923c",
    description: "Módulo de mesas, comandas e caixa em planejamento.",
  },
  {
    slug: "fornecedores",
    name: "Fornecedores",
    icon: "▦",
    color: "#fbbf24",
    description: "Módulo de pedidos e entregas em planejamento.",
  },
  {
    slug: "logistica",
    name: "Entregadores e logística",
    icon: "➜",
    color: "#f87171",
    description: "Módulo de rotas em planejamento.",
  },
  {
    slug: "academia",
    name: "Academia",
    icon: "◈",
    color: "#c084fc",
    description: "Turmas com vagas, inscrições online e agenda individual.",
  },
] as const;
export const plans = [
  { id: "essencial", name: "Essencial", cents: 4990, staff: 1 },
  { id: "profissional", name: "Profissional", cents: 8990, staff: 3 },
  { id: "empresarial", name: "Empresarial", cents: 14990, staff: 10 },
] as const;
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
