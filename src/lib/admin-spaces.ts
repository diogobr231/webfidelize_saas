import { niches, plans } from "./catalog";

export const ADMIN_SPACES_PAGE_SIZE = 25;
export const adminSpaceStatuses = [
  "all",
  "trialing",
  "trial_expired",
  "active",
  "past_due",
  "pending_card",
  "suspended",
  "canceled",
] as const;
export const adminSpaceStatusLabels: Record<
  (typeof adminSpaceStatuses)[number],
  string
> = {
  all: "Todas as situações",
  trialing: "Teste em andamento",
  trial_expired: "Teste encerrado",
  active: "Ativa",
  past_due: "Pagamento pendente",
  pending_card: "Ativação pendente",
  suspended: "Suspensa",
  canceled: "Cancelada",
};
const planIds = ["all", ...plans.map((plan) => plan.id)] as const;
const nicheIds = ["all", ...niches.map((niche) => niche.slug)] as const;
type RawFilters = {
  q?: unknown;
  plano?: unknown;
  situacao?: unknown;
  segmento?: unknown;
  pagina?: unknown;
};
export type AdminSpacesFilters = {
  search: string;
  plan: (typeof planIds)[number];
  status: (typeof adminSpaceStatuses)[number];
  niche: (typeof nicheIds)[number];
  page: number;
  warning: string | null;
};

export function adminSpacesFilters(input: RawFilters): AdminSpacesFilters {
  const warnings: string[] = [];
  const rawSearch = typeof input.q === "string" ? input.q.trim() : "";
  if (input.q !== undefined && typeof input.q !== "string")
    warnings.push("Informe um único nome para a busca.");
  if (Array.from(rawSearch).length > 80)
    warnings.push("A busca foi limitada aos primeiros 80 caracteres.");
  function choice<T extends readonly string[]>(
    raw: unknown,
    options: T,
  ): T[number] {
    if (raw === undefined || raw === "") return "all";
    if (typeof raw === "string" && options.includes(raw)) return raw;
    warnings.push("Um filtro inválido foi desconsiderado.");
    return "all";
  }
  const parsedPage =
    typeof input.pagina === "string" && /^[1-9]\d*$/.test(input.pagina)
      ? Number(input.pagina)
      : 1;
  const page =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  return {
    search: Array.from(rawSearch).slice(0, 80).join(""),
    plan: choice(input.plano, planIds),
    status: choice(input.situacao, adminSpaceStatuses),
    niche: choice(input.segmento, nicheIds),
    page,
    warning: warnings.length ? [...new Set(warnings)].join(" ") : null,
  };
}

/** Percent, underscore and backslash belong to the company name, not the LIKE syntax. */
export function adminSpaceNamePattern(name: string): string {
  return `%${name.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** No arbitrary page cap: every counted company remains reachable. */
export function adminSpacesPagination(requestedPage: number, total: number) {
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(safeTotal / ADMIN_SPACES_PAGE_SIZE));
  const requested =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const page = Math.min(requested, pages);
  const from = (page - 1) * ADMIN_SPACES_PAGE_SIZE;
  return {
    page,
    pages,
    from,
    to: Math.min(Number.MAX_SAFE_INTEGER, from + ADMIN_SPACES_PAGE_SIZE - 1),
  };
}

export function adminSpacesHref(
  filters: AdminSpacesFilters,
  page = filters.page,
): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.plan !== "all") params.set("plano", filters.plan);
  if (filters.status !== "all") params.set("situacao", filters.status);
  if (filters.niche !== "all") params.set("segmento", filters.niche);
  if (page > 1) params.set("pagina", String(page));
  return `/admin/espacos${params.size ? `?${params}` : ""}#lista-empresas`;
}
