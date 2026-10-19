export const RECORD_PAGE_SIZE = 25;
export const MAX_RECORD_PAGE = 10_000;

export function recordFilters(input: { q?: unknown; pagina?: unknown }) {
  const rawSearch = typeof input.q === "string" ? input.q.trim() : "";
  const search = Array.from(rawSearch).slice(0, 80).join("");
  const rawPage =
    typeof input.pagina === "string" && /^[1-9]\d{0,5}$/.test(input.pagina)
      ? Number(input.pagina)
      : 1;
  return {
    search,
    page: Math.min(MAX_RECORD_PAGE, rawPage),
    warning:
      input.q !== undefined && typeof input.q !== "string"
        ? "Busca inválida. Informe um nome para pesquisar."
        : Array.from(rawSearch).length > 80
          ? "A busca foi limitada aos primeiros 80 caracteres."
          : null,
  };
}

/** A name containing %, _ or a backslash must stay a literal search term. */
export function recordNamePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export function recordPagination(requestedPage: number, total: number) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / RECORD_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pages, MAX_RECORD_PAGE);
  const from = (page - 1) * RECORD_PAGE_SIZE;
  return { page, pages, from, to: from + RECORD_PAGE_SIZE - 1 };
}
