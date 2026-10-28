"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  CALENDAR_FILE_LIMIT,
  parseCalendarFile,
  type CalendarEntry,
  type CalendarParseResult,
  type CsvColumns,
} from "@/lib/calendar-import";

const mappingSchema = z
  .object({
    selected: z.boolean(),
    professional_id: z.uuid(),
    kind: z.enum(["block", "appointment"]),
    customer_id: z.union([z.uuid(), z.literal("")]),
    service_id: z.union([z.uuid(), z.literal("")]),
  })
  .strict();
export type ImportMapping = z.infer<typeof mappingSchema>;
export type ImportRow = CalendarEntry & {
  mapping: ImportMapping;
  status: string;
  reason?: string;
};
export type CalendarImportState = Partial<CalendarParseResult> & {
  rows?: ImportRow[];
  error?: string;
  message?: string;
  feedbackKey?: string;
  imported?: number;
  duplicates?: number;
  conflicts?: number;
  invalid?: number;
};
const reasons: Record<string, string> = {
  source_changed:
    "Este evento já foi importado com outros dados. Revise o compromisso existente; ele não será sobrescrito.",
  schedule_conflict: "Há outro agendamento ou bloqueio nesse horário.",
  unavailable_record:
    "Profissional, cliente ou serviço indisponível nesta empresa.",
  invalid_interval:
    "Use horários futuros, com término após o início e duração máxima de 31 dias.",
  outside_hours:
    "Horário fora da disponibilidade do profissional. Use bloqueio para preservar a ocupação externa.",
  invalid_service_duration:
    "A duração do evento é diferente da duração do serviço selecionado.",
  duplicate_in_batch: "Evento repetido no arquivo ou na seleção.",
};
const resultSchema = z.object({
  items: z
    .array(
      z.object({
        source_key: z.string(),
        status: z.enum([
          "ready",
          "imported",
          "duplicate",
          "conflict",
          "invalid",
        ]),
        reason: z.string().nullish(),
      }),
    )
    .max(200),
  imported: z.number(),
  duplicates: z.number(),
  conflicts: z.number(),
  invalid: z.number(),
});
const field = (form: FormData, name: string, max = 200) => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : "";
};

export async function importCalendar(
  companyId: string,
  _previous: CalendarImportState,
  form: FormData,
): Promise<CalendarImportState> {
  const { db } = await requireCompany(companyId, true, true);
  const feedbackKey = randomUUID();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > CALENDAR_FILE_LIMIT)
    return {
      error: "Selecione um arquivo ICS ou CSV de até 1 MB.",
      feedbackKey,
    };
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (extension !== "ics" && extension !== "csv")
    return {
      error:
        "Envie .ics ou .csv. Se o Google entregou um ZIP, extraia o arquivo ICS antes.",
      feedbackKey,
    };
  let columns: CsvColumns | undefined;
  let mappings: Record<string, ImportMapping> = {};
  try {
    const rawColumns = field(form, "columns", 2000);
    if (rawColumns)
      columns = z
        .object({
          title: z.number().int(),
          start: z.number().int(),
          end: z.number().int(),
          startTime: z.number().int(),
          endTime: z.number().int(),
          id: z.number().int(),
          allDay: z.number().int(),
        })
        .strict()
        .parse(JSON.parse(rawColumns));
    const rawMappings = form.get("mappings");
    if (typeof rawMappings === "string" && rawMappings) {
      if (rawMappings.length > 150000) throw new Error("mapping size");
      mappings = z
        .record(z.string().regex(/^[a-f0-9]{64}$/), mappingSchema)
        .parse(JSON.parse(rawMappings));
      if (Object.keys(mappings).length > 200) throw new Error("mapping count");
    }
  } catch {
    return {
      error: "Revise a seleção e os vínculos dos eventos antes de continuar.",
      feedbackKey,
    };
  }
  let parsed: CalendarParseResult;
  try {
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = parseCalendarFile(text, extension, {
      from: field(form, "from"),
      to: field(form, "to"),
      timezone: field(form, "timezone"),
      dateOrder:
        field(form, "date_order") === "us"
          ? "us"
          : field(form, "date_order") === "iso"
            ? "iso"
            : "br",
      columns,
    });
  } catch {
    return {
      error:
        "Não foi possível ler o arquivo. Exporte em UTF-8 e tente novamente.",
      feedbackKey,
    };
  }
  if (parsed.error) return { ...parsed, feedbackKey };
  const professional = z.uuid().safeParse(field(form, "professional_id"));
  if (!professional.success)
    return {
      ...parsed,
      error: "Selecione um profissional ativo para receber os horários.",
      feedbackKey,
    };
  const rows: ImportRow[] = parsed.entries.map((entry) => ({
    ...entry,
    status: "pending",
    mapping: mappings[entry.source_key] ?? {
      selected: field(form, "selection_initialized") !== "yes",
      professional_id: professional.data,
      kind: "block",
      customer_id: "",
      service_id: "",
    },
  }));
  const selected = rows.filter((row) => row.mapping.selected);
  if (!selected.length)
    return {
      ...parsed,
      rows,
      error: "Selecione ao menos um evento válido para conferir os horários.",
      feedbackKey,
    };
  const invalidMapping = selected.some(
    (row) =>
      row.mapping.kind === "appointment" &&
      (!row.mapping.customer_id || !row.mapping.service_id),
  );
  if (invalidMapping)
    return {
      ...parsed,
      rows,
      error:
        "Para criar atendimento, selecione cliente e serviço em cada evento. Use horário ocupado quando ainda não tiver esses cadastros.",
      feedbackKey,
    };
  const commit = field(form, "intent") === "import";
  if (commit && form.get("confirm_import") !== "yes")
    return {
      ...parsed,
      rows,
      error: "Confirme a seleção antes de importar. Nenhum item foi salvo.",
      feedbackKey,
    };
  const { data, error } = await db.rpc("import_calendar_entries", {
    p_company: companyId,
    p_dry_run: !commit,
    p_items: selected.map((row) => ({
      source_key: row.source_key,
      professional_id: row.mapping.professional_id,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      kind: row.mapping.kind,
      customer_id:
        row.mapping.kind === "appointment" ? row.mapping.customer_id : null,
      service_id:
        row.mapping.kind === "appointment" ? row.mapping.service_id : null,
    })),
  });
  const checked = resultSchema.safeParse(data);
  if (error || !checked.success)
    return {
      ...parsed,
      rows,
      error:
        "Não foi possível conferir a importação. Verifique sua permissão e o acesso da empresa e tente novamente. Nenhum novo envio será feito automaticamente.",
      feedbackKey,
    };
  const result = checked.data;
  const byKey = new Map(result.items.map((item) => [item.source_key, item]));
  for (const row of rows) {
    const item = byKey.get(row.source_key);
    row.status = row.mapping.selected
      ? (item?.status ?? "invalid")
      : "unselected";
    row.reason = item?.reason
      ? (reasons[item.reason] ??
        "Evento inválido. Revise os horários e os vínculos.")
      : undefined;
  }
  if (commit && result.imported > 0)
    revalidatePath(`/painel/${companyId}`, "layout");
  return {
    ...parsed,
    rows,
    feedbackKey,
    ...result,
    error:
      result.conflicts || result.invalid
        ? "Há itens que precisam de revisão. Desmarque-os ou ajuste os vínculos e confira novamente. O lote não foi salvo."
        : undefined,
    message:
      commit && !result.conflicts && !result.invalid
        ? `${result.imported} horário(s) importado(s). ${result.duplicates} já importado(s) anteriormente; não recriados.`
        : "Prévia conferida. Nada foi salvo; revise os eventos antes de confirmar.",
  };
}
