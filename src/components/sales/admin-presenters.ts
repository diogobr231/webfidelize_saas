import { salesStages, type SalesStage } from "@/lib/sales";

export const SALES_PAGE_SIZE = 28;
export const SALES_HISTORY_PAGE_SIZE = 20;
export const salesPriorities = [
  { value: "low", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
] as const;

export function salesPageNumber(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value)
    ? Math.min(10_000, Number(value))
    : 1;
}

export function salesStageFilter(value: unknown): SalesStage | null {
  return salesStages.find((stage) => stage.value === value)?.value ?? null;
}

export function salesPageHref(
  path: string,
  values: Record<string, string | number | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "")
      params.set(name, String(value));
  }
  return `${path}${params.size ? `?${params}` : ""}`;
}

export function salesLabel(
  options: readonly { value: string; label: string }[],
  value: string | null | undefined,
) {
  return (
    options.find((item) => item.value === value)?.label || "Ainda não informado"
  );
}

export function salesDate(
  value: string | null | undefined,
  includeTime = true,
) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Não definido";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

export function salesDateInput(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(" ", "T");
}

export function salesMoneyInput(value: number | null | undefined) {
  return value === null || value === undefined
    ? ""
    : (value / 100).toFixed(2).replace(".", ",");
}

export function salesActivityLabel(kind: string) {
  return (
    (
      {
        created: "Contato registrado",
        updated: "Dados atualizados",
        stage_changed: "Etapa atualizada",
        note: "Anotação interna",
      } as Record<string, string>
    )[kind] || "Atualização comercial"
  );
}
