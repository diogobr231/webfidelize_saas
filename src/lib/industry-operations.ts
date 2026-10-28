import { z } from "zod";
import { localAppointmentInstant } from "./scheduling";

export const industryOperationDefinitions = {
  restaurante: [
    {
      kind: "restaurant_table",
      label: "Mesa",
      icon: "building",
      nameLabel: "Identificação da mesa",
      fields: ["capacity"],
      initial: "available",
    },
    {
      kind: "restaurant_order",
      label: "Comanda / pedido",
      icon: "briefcase",
      nameLabel: "Número ou nome da comanda",
      fields: ["related", "details", "amount", "due"],
      initial: "open",
    },
    {
      kind: "restaurant_cash",
      label: "Movimentação de caixa",
      icon: "briefcase",
      nameLabel: "Descrição da movimentação",
      fields: ["reference", "details", "amount"],
      initial: "recorded",
    },
  ],
  fornecedores: [
    {
      kind: "supplier_order",
      label: "Pedido a fornecedor",
      icon: "briefcase",
      nameLabel: "Identificação do pedido",
      fields: ["reference", "details", "amount", "due"],
      initial: "requested",
    },
    {
      kind: "delivery",
      label: "Entrega",
      icon: "map-pin",
      nameLabel: "Pedido / entrega",
      fields: ["reference", "phone", "details", "due", "location"],
      initial: "pending",
    },
  ],
  logistica: [
    {
      kind: "logistics_driver",
      label: "Entregador",
      icon: "user",
      nameLabel: "Nome do entregador",
      fields: ["phone", "reference"],
      initial: "available",
    },
    {
      kind: "logistics_route",
      label: "Rota",
      icon: "map-pin",
      nameLabel: "Identificação da rota",
      fields: ["related", "details", "due", "location"],
      initial: "planned",
    },
    {
      kind: "logistics_delivery",
      label: "Entrega",
      icon: "map-pin",
      nameLabel: "Pedido / entrega",
      fields: ["reference", "related", "phone", "details", "due", "location"],
      initial: "pending",
    },
  ],
  "pet-shop": [
    {
      kind: "pet_profile",
      label: "Pet e tutor",
      icon: "heart",
      nameLabel: "Nome do pet",
      fields: ["reference", "phone", "details"],
      initial: "active",
    },
    {
      kind: "pet_visit",
      label: "Atendimento do pet",
      icon: "calendar",
      nameLabel: "Atendimento ou serviço",
      fields: ["related", "details", "due"],
      initial: "scheduled",
    },
    {
      kind: "pet_stock",
      label: "Estoque",
      icon: "briefcase",
      nameLabel: "Produto",
      fields: ["reference", "quantity", "unit"],
      initial: "active",
    },
  ],
  escritorio: [
    {
      kind: "office_task",
      label: "Tarefa",
      icon: "check",
      nameLabel: "Tarefa",
      fields: ["reference", "details", "due"],
      initial: "open",
    },
    {
      kind: "office_document",
      label: "Documento",
      icon: "briefcase",
      nameLabel: "Nome do documento",
      fields: ["reference", "details", "location"],
      initial: "active",
    },
    {
      kind: "office_process",
      label: "Processo",
      icon: "layout",
      nameLabel: "Nome ou número do processo",
      fields: ["reference", "details", "due"],
      initial: "open",
    },
  ],
  salao: [
    {
      kind: "salon_commission",
      label: "Comissão",
      icon: "briefcase",
      nameLabel: "Atendimento ou venda",
      fields: ["reference", "details", "amount"],
      initial: "pending",
    },
    {
      kind: "salon_cash",
      label: "Movimentação de caixa",
      icon: "briefcase",
      nameLabel: "Descrição da movimentação",
      fields: ["reference", "details", "amount"],
      initial: "recorded",
    },
    {
      kind: "salon_stock",
      label: "Estoque",
      icon: "briefcase",
      nameLabel: "Produto",
      fields: ["reference", "quantity", "unit"],
      initial: "active",
    },
  ],
  academia: [
    {
      kind: "academy_training",
      label: "Ficha de treino",
      icon: "check",
      nameLabel: "Nome da ficha",
      fields: ["reference", "details"],
      initial: "active",
    },
    {
      kind: "academy_attendance",
      label: "Presença em turma",
      icon: "users",
      nameLabel: "Aula ou turma",
      fields: ["reference", "due"],
      initial: "scheduled",
    },
    {
      kind: "academy_membership",
      label: "Plano do aluno",
      icon: "briefcase",
      nameLabel: "Nome do plano",
      fields: ["reference", "due"],
      initial: "active",
    },
  ],
} as const;

export type IndustryNiche = keyof typeof industryOperationDefinitions;
export type IndustryOperationKind =
  (typeof industryOperationDefinitions)[IndustryNiche][number]["kind"];
export type IndustryOperationCursor = {
  createdAt: string;
  id: string;
  direction: "before" | "after";
};

export function parseIndustryOperationCursor(
  createdAt: unknown,
  id: unknown,
  direction: unknown,
): IndustryOperationCursor | null {
  if (
    typeof createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      createdAt,
    ) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    typeof id !== "string" ||
    !z.uuid().safeParse(id).success ||
    (direction !== "before" && direction !== "after")
  ) {
    return null;
  }
  return { createdAt, id, direction };
}

export type IndustryOperationField =
  | "reference"
  | "related"
  | "details"
  | "phone"
  | "capacity"
  | "quantity"
  | "unit"
  | "amount"
  | "due"
  | "location";

export function industryOperationPage<T>(
  fetched: readonly T[],
  direction: "before" | "after",
  hasCursor: boolean,
) {
  const hasMore = fetched.length > 100;
  const page = fetched.slice(0, 100);
  return {
    rows: direction === "before" ? page.reverse() : page,
    hasPrevious: direction === "before" ? hasMore : hasCursor,
    hasNext: direction === "before" ? hasCursor : hasMore,
  };
}

export const operationStatusLabels: Record<string, string> = {
  available: "Livre",
  occupied: "Ocupada",
  reserved: "Reservada",
  open: "Aberta",
  preparing: "Em preparo",
  ready: "Pronta",
  served: "Servida",
  paid: "Paga",
  cancelled: "Cancelada",
  recorded: "Registrada",
  voided: "Estornada",
  requested: "Solicitado",
  approved: "Aprovado",
  received: "Recebido",
  pending: "Pendente",
  in_transit: "Em rota",
  delivered: "Entregue",
  planned: "Planejada",
  in_progress: "Em andamento",
  completed: "Concluída",
  available_driver: "Disponível",
  on_route: "Em rota",
  inactive: "Inativo",
  active: "Ativo",
  scheduled: "Agendado",
  archived: "Arquivado",
  arrived: "Recebido",
  expired: "Vencido",
  attended: "Presente",
  missed: "Falta",
};

const transitions: Record<string, Record<string, string[]>> = {
  restaurant_table: {
    available: ["reserved"],
    reserved: ["available"],
  },
  restaurant_order: {
    open: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["served"],
    served: ["paid"],
  },
  restaurant_cash: { recorded: ["voided"] },
  supplier_order: {
    requested: ["approved", "cancelled"],
    approved: ["received", "cancelled"],
  },
  delivery: { pending: ["in_transit", "cancelled"], in_transit: ["delivered"] },
  logistics_driver: {
    available: ["on_route", "inactive"],
    on_route: ["available", "inactive"],
    inactive: ["available"],
  },
  logistics_route: {
    planned: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
  },
  logistics_delivery: {
    pending: ["in_transit", "cancelled"],
    in_transit: ["delivered"],
  },
  pet_profile: { active: ["inactive"], inactive: ["active"] },
  pet_visit: { scheduled: ["completed", "cancelled"] },
  pet_stock: { active: ["inactive"], inactive: ["active"] },
  office_task: {
    open: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
  },
  office_document: { active: ["archived"] },
  office_process: {
    open: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
  },
  salon_commission: { pending: ["paid", "cancelled"] },
  salon_cash: { recorded: ["voided"] },
  salon_stock: { active: ["inactive"], inactive: ["active"] },
  academy_training: { active: ["inactive"], inactive: ["active"] },
  academy_attendance: { scheduled: ["attended", "missed"] },
  academy_membership: { active: ["expired", "cancelled"] },
};

export function operationTransitions(kind: string, status: string) {
  return transitions[kind]?.[status] ?? [];
}

export function operationsForNiche(niche: string) {
  return Object.hasOwn(industryOperationDefinitions, niche)
    ? industryOperationDefinitions[niche as IndustryNiche]
    : [];
}

const text = (max: number) => z.string().trim().max(max);
const currency = z
  .string()
  .trim()
  .regex(/^\d{1,7}(?:[,.]\d{1,2})?$/, "Informe o valor em reais.")
  .transform((v) => {
    const [whole, cents = ""] = v.replace(",", ".").split(".");
    return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
  })
  .refine((v) => v <= 10_000_000, "O limite é R$ 100.000,00.");

export type ParsedIndustryOperation = {
  kind: IndustryOperationKind;
  name: string;
  details: string;
  status: string;
  reference: string;
  phone: string;
  quantity: number | null;
  unit: string;
  amount_cents: number | null;
  due_at: string | null;
  location_url: string;
  related_operation_id: string | null;
};

export function parseIndustryOperation(
  form: FormData,
  niche: string,
): ParsedIndustryOperation | null {
  const definitions = operationsForNiche(niche);
  const definition = definitions.find((item) => item.kind === form.get("kind"));
  if (!definition) return null;
  const relatedRaw = form.get("related_operation_id");
  const relatedResult =
    typeof relatedRaw === "string" && relatedRaw !== ""
      ? z.uuid().safeParse(relatedRaw)
      : null;
  const relatedOperationId = relatedResult?.success ? relatedResult.data : null;
  const common = z
    .object({
      name: z.string().trim().min(2).max(120),
      details: text(1200).default(""),
      reference: text(120).default(""),
      phone: z
        .string()
        .trim()
        .refine((v) => v === "" || /^[+]?([\d\s().-]){10,22}$/.test(v))
        .transform((v) => v.replace(/\D/g, ""))
        .refine((v) => v === "" || /^\d{10,13}$/.test(v)),
      quantity: z.string().trim().default(""),
      unit: text(24).default(""),
      amount: z.string().trim().default(""),
      due: z.string().trim().default(""),
      location: z.string().trim().max(500).default(""),
    })
    .safeParse({
      name: form.get("name"),
      details: form.get("details") ?? "",
      reference: form.get("reference") ?? "",
      phone: form.get("phone") ?? "",
      quantity: form.get("quantity") ?? form.get("capacity") ?? "",
      unit: form.get("unit") ?? "",
      amount: form.get("amount") ?? "",
      due: form.get("due") ?? "",
      location: form.get("location") ?? "",
    });
  if (!common.success) return null;
  const value = common.data;
  const required = (
    field: IndustryOperationField,
    input: string | number | null,
  ) =>
    !definition.fields.includes(field as never) ||
    (typeof input === "string" ? input.trim().length > 0 : input !== null);
  const needs = (field: IndustryOperationField) =>
    definition.fields.includes(field as never);
  if (
    needs("related") &&
    !relatedOperationId &&
    definition.kind !== "logistics_delivery"
  )
    return null;
  const quantity =
    value.quantity === ""
      ? null
      : /^\d{1,7}$/.test(value.quantity)
        ? Number(value.quantity)
        : Number.NaN;
  if (
    needs("capacity") &&
    (quantity === null ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 50)
  )
    return null;
  if (
    needs("quantity") &&
    (quantity === null ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > 1_000_000)
  )
    return null;
  if (
    !required("reference", value.reference) ||
    (needs("phone") && !value.phone)
  )
    return null;
  if (
    ["restaurant_cash", "salon_cash"].includes(definition.kind) &&
    !["entrada", "saida"].includes(value.reference)
  )
    return null;
  if (needs("unit") && !value.unit) return null;
  let amount: number | null = null;
  if (needs("amount")) {
    const parsed = currency.safeParse(value.amount);
    if (
      !parsed.success ||
      ((definition.kind === "restaurant_cash" ||
        definition.kind === "salon_cash" ||
        definition.kind === "salon_commission") &&
        parsed.data < 1)
    )
      return null;
    amount = parsed.data;
  }
  let dueAt: string | null = null;
  if (needs("due")) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.due)) return null;
    const instant = localAppointmentInstant(
      value.due.slice(0, 10),
      value.due.slice(11, 16),
    );
    if (!instant) return null;
    dueAt = instant;
  }
  let locationUrl = "";
  if (needs("location")) {
    if (value.location) {
      try {
        const url = new URL(value.location);
        const mapHosts = [
          "maps.app.goo.gl",
          "maps.google.com",
          "www.google.com",
        ];
        const mapUrl =
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          mapHosts.includes(url.hostname) &&
          (url.hostname !== "www.google.com" ||
            url.pathname.startsWith("/maps"));
        const docUrl =
          definition.kind === "office_document" &&
          url.protocol === "https:" &&
          !url.port &&
          !!url.hostname &&
          !url.username &&
          !url.password;
        if (!mapUrl && !docUrl) return null;
        locationUrl = url.toString();
      } catch {
        return null;
      }
    }
  }
  if (
    ["delivery", "logistics_delivery", "logistics_route"].includes(
      definition.kind,
    ) &&
    locationUrl &&
    !/^https:\/\/(maps\.app\.goo\.gl\/|maps\.google\.com\/|www\.google\.com\/maps)/.test(
      locationUrl,
    )
  )
    return null;
  return {
    kind: definition.kind,
    name: value.name,
    details: value.details,
    status: definition.initial,
    reference: value.reference,
    phone: value.phone,
    quantity,
    unit: value.unit,
    amount_cents: amount,
    due_at: dueAt,
    location_url: locationUrl,
    related_operation_id: relatedOperationId,
  };
}

export function parseIndustryStatus(form: FormData) {
  const parsed = z
    .object({
      id: z.uuid(),
      version: z
        .string()
        .regex(/^[1-9]\d{0,9}$/)
        .transform(Number),
      status: z.string().regex(/^[a-z_]{2,24}$/),
    })
    .safeParse({
      id: form.get("id"),
      version: form.get("version"),
      status: form.get("status"),
    });
  return parsed.success ? parsed.data : null;
}
