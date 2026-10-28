import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { addDays, APPOINTMENT_ZONE, validDay } from "./scheduling";

export const CALENDAR_FILE_LIMIT = 1024 * 1024;
export const CALENDAR_ENTRY_LIMIT = 200;
export type CsvColumns = {
  title: number;
  start: number;
  end: number;
  startTime: number;
  endTime: number;
  id: number;
  allDay: number;
};
export type CalendarImportOptions = {
  from: string;
  to: string;
  timezone: string;
  dateOrder: "br" | "us" | "iso";
  columns?: CsvColumns;
};
export type CalendarEntry = {
  source_key: string;
  title: string;
  starts_at: string;
  ends_at: string;
};
export type CalendarParseResult = {
  entries: CalendarEntry[];
  issues: { title: string; reason: string }[];
  issueCount: number;
  outsideWindow: number;
  headers: string[];
  columns?: CsvColumns;
  error?: string;
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const clean = (value: unknown, length = 120) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, length);
const pad = (value: number) => String(value).padStart(2, "0");
type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
const wallText = (p: Wall) =>
  `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  if (!formatterCache.has(zone)) {
    if (formatterCache.size >= 32) formatterCache.clear();
    formatterCache.set(
      zone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return formatterCache.get(zone)!;
}
/** Reject missing/ambiguous DST wall times instead of guessing an appointment. */
export function calendarInstant(wall: Wall, zone: string): string {
  const text = wallText(wall);
  if (
    !validDay(text.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)
  )
    throw new Error("Data ou hora inválida.");
  let format: Intl.DateTimeFormat;
  try {
    format = formatter(zone);
  } catch {
    throw new Error(
      "Fuso não reconhecido. Use um fuso IANA, como America/Sao_Paulo.",
    );
  }
  const naive = Date.parse(text + "Z");
  const display = (instant: number) => {
    const parts = Object.fromEntries(
      format.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const possible = new Set<number>();
  for (const shift of [-86400000, 0, 86400000]) {
    const sample = naive + shift;
    const offset = Date.parse(display(sample) + "Z") - sample;
    const candidate = naive - offset;
    if (display(candidate) === text) possible.add(candidate);
  }
  if (possible.size !== 1)
    throw new Error(
      "Horário inexistente ou ambíguo na mudança de fuso. Ajuste o evento na origem.",
    );
  return new Date([...possible][0]).toISOString();
}

export function readCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0];
  let headerQuoted = false,
    commas = 0,
    semicolons = 0;
  for (let i = 0; i < first.length; i++) {
    if (first[i] === '"') {
      if (headerQuoted && first[i + 1] === '"') i++;
      else headerQuoted = !headerQuoted;
    } else if (!headerQuoted) {
      if (first[i] === ",") commas++;
      if (first[i] === ";") semicolons++;
    }
  }
  const separator = semicolons > commas ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const cell = () => {
    if (field.length > 8192 || row.length >= 50)
      throw new Error("CSV com campos ou colunas demais.");
    row.push(field);
    field = "";
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    if (rows.length > 3001)
      throw new Error(
        "CSV com mais de 3.000 linhas. Exporte um período menor.",
      );
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === separator) cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed && c.trim()) throw new Error("CSV com aspas inválidas.");
      field += c;
    }
    if (field.length > 8192) throw new Error("CSV com campo muito longo.");
  }
  if (quoted) throw new Error("CSV com aspas não fechadas.");
  if (field || row.length) line();
  return rows;
}
export function guessCsvColumns(headers: string[]): CsvColumns {
  const normalized = headers.map((h) =>
    h
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  );
  const find = (...names: string[]) =>
    normalized.findIndex((h) => names.includes(h));
  return {
    title: find("titulo", "assunto", "subject", "summary", "title", "nome"),
    start: find(
      "inicio",
      "start",
      "startdate",
      "datainicio",
      "startsat",
      "data",
    ),
    end: find("fim", "end", "enddate", "datafim", "endsat"),
    startTime: find("horainicio", "starttime", "horario", "hora"),
    endTime: find("horafim", "endtime"),
    id: find("id", "uid", "eventid", "idevento"),
    allDay: find("diainteiro", "alldayevent", "allday"),
  };
}
function csvInstant(
  date: string,
  time: string,
  options: CalendarImportOptions,
) {
  const raw = `${date.trim()}${time.trim() ? " " + time.trim() : ""}`;
  if (
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      raw,
    )
  ) {
    const instant = Date.parse(raw);
    if (!validDay(raw.slice(0, 10)) || !Number.isFinite(instant))
      throw new Error("Data ou hora inválida.");
    return new Date(instant).toISOString();
  }
  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i,
  );
  if (!match)
    throw new Error(
      "Use data e hora explícitas; eventos de dia inteiro não são importados.",
    );
  let day = match[1];
  if (day.includes("/")) {
    if (options.dateOrder === "iso")
      throw new Error("Formato selecionado exige datas AAAA-MM-DD.");
    const [a, b, y] = day.split("/");
    day = `${y}-${pad(Number(options.dateOrder === "us" ? a : b))}-${pad(Number(options.dateOrder === "us" ? b : a))}`;
  }
  let hour = Number(match[2]);
  if (match[5]) {
    if (hour < 1 || hour > 12) throw new Error("Hora inválida.");
    hour = (hour % 12) + (match[5].toUpperCase() === "PM" ? 12 : 0);
  }
  const [year, month, d] = day.split("-").map(Number);
  return calendarInstant(
    {
      year,
      month,
      day: d,
      hour,
      minute: Number(match[3]),
      second: Number(match[4] || 0),
    },
    options.timezone,
  );
}

export function parseCalendarFile(
  text: string,
  format: "ics" | "csv",
  options: CalendarImportOptions,
): CalendarParseResult {
  const result: CalendarParseResult = {
    entries: [],
    issues: [],
    issueCount: 0,
    outsideWindow: 0,
    headers: [],
  };
  const issue = (title: string, reason: string) => {
    result.issueCount++;
    if (result.issues.length < 200)
      result.issues.push({
        title: clean(title) || "Evento sem título",
        reason,
      });
  };
  try {
    if (Buffer.byteLength(text, "utf8") > CALENDAR_FILE_LIMIT)
      throw new Error("O arquivo deve ter até 1 MB.");
    if (
      !validDay(options.from) ||
      !validDay(options.to) ||
      options.to < options.from ||
      options.to > addDays(options.from, 89)
    )
      throw new Error("Escolha um período de até 90 dias, com datas válidas.");
    formatter(options.timezone);
    const startWindow = Date.parse(
      calendarInstant(
        {
          year: Number(options.from.slice(0, 4)),
          month: Number(options.from.slice(5, 7)),
          day: Number(options.from.slice(8, 10)),
          hour: 0,
          minute: 0,
          second: 0,
        },
        APPOINTMENT_ZONE,
      ),
    );
    const next = addDays(options.to, 1);
    const endWindow = Date.parse(
      calendarInstant(
        {
          year: Number(next.slice(0, 4)),
          month: Number(next.slice(5, 7)),
          day: Number(next.slice(8, 10)),
          hour: 0,
          minute: 0,
          second: 0,
        },
        APPOINTMENT_ZONE,
      ),
    );
    const add = (key: string, title: string, start: string, end: string) => {
      if (
        Date.parse(end) <= Date.parse(start) ||
        Date.parse(end) - Date.parse(start) > 31 * 86400000
      )
        throw new Error(
          "O término deve ser após o início; limite de 31 dias por compromisso.",
        );
      if (Date.parse(start) < startWindow || Date.parse(start) >= endWindow) {
        result.outsideWindow++;
        return;
      }
      result.entries.push({
        source_key: digest(key),
        title: clean(title) || "Compromisso sem título",
        starts_at: start,
        ends_at: end,
      });
      if (result.entries.length > CALENDAR_ENTRY_LIMIT)
        throw new Error("LIMIT_ENTRIES");
    };
    text = text.replace(/^\uFEFF/, "");
    if (format === "csv") {
      const rows = readCsv(text);
      result.headers = (rows.shift() || []).map((h) => clean(h, 80));
      result.columns = options.columns ?? guessCsvColumns(result.headers);
      const c = result.columns;
      if (
        !result.headers.length ||
        Object.values(c).some(
          (v) => !Number.isInteger(v) || v < -1 || v >= result.headers.length,
        ) ||
        c.start < 0 ||
        (c.end < 0 && c.endTime < 0)
      )
        throw new Error(
          "Selecione as colunas de início e término do CSV abaixo e gere a prévia novamente.",
        );
      for (const [index, row] of rows.entries()) {
        const title = c.title >= 0 ? row[c.title] || "" : `Linha ${index + 2}`;
        try {
          if (row.length !== result.headers.length)
            throw new Error("Quantidade de colunas diferente do cabeçalho.");
          if (c.allDay >= 0 && /^(true|yes|sim|1)$/i.test(row[c.allDay].trim()))
            throw new Error(
              "Evento de dia inteiro: ajuste horários na origem antes de importar.",
            );
          const start = csvInstant(
            row[c.start],
            c.startTime >= 0 ? row[c.startTime] : "",
            options,
          );
          const end = csvInstant(
            c.end >= 0 ? row[c.end] : row[c.start],
            c.endTime >= 0 ? row[c.endTime] : "",
            options,
          );
          const identifier = c.id >= 0 ? row[c.id].trim() : "";
          add(
            identifier
              ? `csv:id:${identifier}`
              : `csv:event:${start}|${end}|${title.trim()}`,
            title,
            start,
            end,
          );
        } catch (error) {
          if (error instanceof Error && error.message === "LIMIT_ENTRIES")
            throw error;
          issue(
            title,
            error instanceof Error ? error.message : "Linha inválida.",
          );
        }
      }
    } else {
      const lines = text.split(/\r?\n/);
      if (lines.length > 20000)
        throw new Error("Arquivo com linhas demais. Exporte um período menor.");
      let depth = 0;
      for (const line of lines) {
        if (/^BEGIN:/i.test(line)) depth++;
        if (depth > 12)
          throw new Error("Estrutura de calendário muito complexa.");
        if (/^END:/i.test(line)) depth--;
        if (depth < 0) throw new Error("Estrutura de calendário inválida.");
      }
      if (depth || !text.startsWith("BEGIN:VCALENDAR"))
        throw new Error(
          "Envie um arquivo .ics válido, extraído do ZIP se necessário.",
        );
      // Bound hostile recurrence input before ICAL.js decorates or sorts it.
      // The file size cap alone does not bound the library's inner algorithms.
      let extraDates = 0;
      for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
        if (/^(EXDATE|RDATE)(?:;[^:]*)?:/i.test(line)) {
          extraDates += line.slice(line.indexOf(":") + 1).split(",").length;
          if (extraDates > 2000)
            throw new Error(
              "Mais de 2.000 datas adicionais ou exceções. Exporte um período menor.",
            );
        }
        if (!/^RRULE:/i.test(line)) continue;
        if (line.length > 512)
          throw new Error(
            "Regra de recorrência muito longa. Simplifique a repetição na origem.",
          );
        const fields = line
          .slice(line.indexOf(":") + 1)
          .toUpperCase()
          .split(";");
        const rawDays = fields
          .find((part) => part.startsWith("BYDAY="))
          ?.slice(6);
        if (rawDays && rawDays.split(",").length > 7)
          throw new Error(
            "Regra de recorrência com dias demais. Use no máximo os sete dias da semana.",
          );
        for (const part of fields.filter((value) =>
          /^(INTERVAL|COUNT)=/.test(value),
        )) {
          const [name, value] = part.split("=");
          if (
            !/^[1-9]\d*$/.test(value) ||
            !Number.isSafeInteger(Number(value)) ||
            Number(value) > (name === "INTERVAL" ? 366 : 100000)
          )
            throw new Error(
              "Intervalo ou quantidade da recorrência inválido ou excessivo.",
            );
        }
      }
      const calendar = new ICAL.Component(ICAL.parse(text));
      if (calendar.name !== "vcalendar")
        throw new Error("Calendário inválido.");
      const events = calendar.getAllSubcomponents("vevent");
      if (events.length > 2000)
        throw new Error(
          "Mais de 2.000 eventos no arquivo. Exporte um período menor.",
        );
      const groups = new Map<string, InstanceType<typeof ICAL.Component>[]>();
      for (const component of events) {
        const uid = String(component.getFirstPropertyValue("uid") || "");
        if (!uid || uid.length > 2048) {
          issue(
            String(component.getFirstPropertyValue("summary") || ""),
            "Evento sem identificador UID válido.",
          );
          continue;
        }
        groups.set(uid, [...(groups.get(uid) || []), component]);
      }
      let iterations = 0;
      type Component = InstanceType<typeof ICAL.Component>;
      type Time = InstanceType<typeof ICAL.Time>;
      const propTime = (component: Component, name: string) => {
        const value = component.getFirstPropertyValue(name);
        if (!(value instanceof ICAL.Time))
          throw new Error("Evento sem início/término válido.");
        return value;
      };
      const zone = (component: Component, name: string, fallback: string) => {
        const value = propTime(component, name);
        if (value.isDate)
          throw new Error(
            "Evento de dia inteiro: ajuste horários na origem antes de importar.",
          );
        if (value.zone === ICAL.Timezone.utcTimezone) return "UTC";
        const declared = component.getFirstProperty(name)?.getParameter("tzid");
        const id = typeof declared === "string" ? declared : fallback;
        try {
          formatter(id);
        } catch {
          throw new Error(
            "Fuso não reconhecido; exporte com um fuso IANA ou UTC.",
          );
        }
        return id;
      };
      const instant = (time: Time, id: string) => calendarInstant(time, id);
      const interval = (
        component: Component,
        occurrence: Time,
        fallback: string,
      ) => {
        const start = propTime(component, "dtstart");
        const tz = zone(component, "dtstart", fallback);
        let end: Time;
        if (component.hasProperty("dtend")) {
          end = propTime(component, "dtend");
          const endZone = zone(component, "dtend", tz);
          if (endZone !== tz && occurrence !== start)
            throw new Error(
              "Recorrência com fusos diferentes no início e fim não suportada.",
            );
          if (occurrence === start)
            return [instant(start, tz), instant(end, endZone)];
          const duration =
            Date.parse(wallText(end) + "Z") - Date.parse(wallText(start) + "Z");
          end = occurrence.clone();
          end.addDuration(ICAL.Duration.fromSeconds(duration / 1000));
        } else {
          const duration = component.getFirstPropertyValue("duration");
          if (!(duration instanceof ICAL.Duration) || duration.toSeconds() <= 0)
            throw new Error("Evento sem duração ou término explícito.");
          end = occurrence.clone();
          end.addDuration(duration);
        }
        return [instant(occurrence, tz), instant(end, tz)];
      };
      for (const [uid, group] of groups) {
        const masters = group.filter((c) => !c.hasProperty("recurrence-id"));
        const exceptions = group.filter((c) => c.hasProperty("recurrence-id"));
        const master = masters[0];
        const title = String(
          (master || group[0]).getFirstPropertyValue("summary") || "",
        );
        const beginning = result.entries.length;
        try {
          if (masters.length > 1)
            throw new Error(
              "UID repetido no arquivo. Exporte uma versão única do calendário.",
            );
          if (
            exceptions.some((e) =>
              e.getFirstProperty("recurrence-id")?.getParameter("range"),
            )
          )
            throw new Error(
              "Exceção de recorrência que altera eventos futuros não suportada; exporte as ocorrências separadas.",
            );
          const baseZone = master
            ? zone(master, "dtstart", options.timezone)
            : options.timezone;
          const override = new Map<string, Component>();
          for (const c of exceptions) {
            const key = instant(
              propTime(c, "recurrence-id"),
              zone(c, "recurrence-id", baseZone),
            );
            if (override.has(key))
              throw new Error("Mais de uma exceção para a mesma ocorrência.");
            override.set(key, c);
          }
          const emit = (c: Component, when: Time, key: string) => {
            if (
              String(c.getFirstPropertyValue("status") || "").toUpperCase() ===
              "CANCELLED"
            ) {
              issue(title, "Evento cancelado na origem.");
              return;
            }
            if (
              String(c.getFirstPropertyValue("transp") || "").toUpperCase() ===
              "TRANSPARENT"
            ) {
              issue(
                title,
                "Evento marcado como livre na origem; não ocupa a agenda.",
              );
              return;
            }
            const [start, end] = interval(c, when, baseZone);
            add(
              key,
              String(c.getFirstPropertyValue("summary") || title),
              start,
              end,
            );
          };
          // Exceptions are emitted independently, including those moved into the chosen period.
          for (const [original, c] of override) {
            if (
              String(c.getFirstPropertyValue("status") || "").toUpperCase() ===
              "CANCELLED"
            ) {
              issue(title, "Ocorrência cancelada na origem.");
              continue;
            }
            emit(c, propTime(c, "dtstart"), `ics:${uid}|${original}`);
          }
          if (!master) continue;
          const start = propTime(master, "dtstart");
          const rules = master.getAllProperties("rrule");
          const recurring = rules.length || master.hasProperty("rdate");
          if (!recurring) {
            emit(master, start, `ics:${uid}`);
            continue;
          }
          if (rules.length > 1 || master.hasProperty("exrule"))
            throw new Error("Múltiplas regras de recorrência não suportadas.");
          const excluded = new Set<string>();
          for (const p of master.getAllProperties("exdate")) {
            const tz = p.getParameter("tzid");
            for (const value of p.getValues()) {
              if (!(value instanceof ICAL.Time) || value.isDate)
                throw new Error("Exceção de recorrência inválida.");
              excluded.add(
                instant(
                  value,
                  value.zone === ICAL.Timezone.utcTimezone
                    ? "UTC"
                    : typeof tz === "string"
                      ? tz
                      : baseZone,
                ),
              );
            }
          }
          const seen = new Set<string>();
          const occurrence = (time: Time) => {
            const original = instant(time, baseZone);
            if (
              !seen.has(original) &&
              !override.has(original) &&
              !excluded.has(original)
            ) {
              seen.add(original);
              emit(master, time, `ics:${uid}|${original}`);
            }
          };
          if (rules.length) {
            const rule = rules[0].getFirstValue();
            if (
              !(rule instanceof ICAL.Recur) ||
              !["DAILY", "WEEKLY"].includes(rule.freq) ||
              !Number.isSafeInteger(rule.interval) ||
              rule.interval < 1 ||
              rule.interval > 366 ||
              (rule.count !== null &&
                (!Number.isSafeInteger(rule.count) ||
                  rule.count < 1 ||
                  rule.count > 100000)) ||
              (rule.parts.BYDAY || []).length > 7 ||
              rule.until?.isDate ||
              (rule.freq === "DAILY" && !!rule.parts.BYDAY?.length) ||
              Object.keys(rule.parts).some((k) => k !== "BYDAY") ||
              (rule.parts.BYDAY || []).some(
                (v) => !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(String(v)),
              )
            )
              throw new Error(
                "Recorrência não suportada: use diária por intervalo, quantidade ou término; para escolher dias da semana, use repetição semanal.",
              );
            const until = rule.until
              ? instant(
                  rule.until,
                  rule.until.zone === ICAL.Timezone.utcTimezone
                    ? "UTC"
                    : baseZone,
                )
              : null;
            const safeRule = rule.clone();
            safeRule.until = null;
            const iterator = safeRule.iterator(start);
            for (;;) {
              if (++iterations > 20000)
                throw new Error(
                  "Recorrência muito antiga ou complexa. Exporte um período menor sem séries antigas.",
                );
              const next = iterator.next();
              if (!next) break;
              const nominal = Date.parse(wallText(next) + "Z");
              if (nominal > endWindow + 86400000) break;
              if (nominal < startWindow - 86400000) continue;
              const iso = instant(next, baseZone);
              if (until && iso > until) break;
              occurrence(next);
            }
          } else occurrence(start);
          for (const p of master.getAllProperties("rdate")) {
            for (const value of p.getValues()) {
              if (!(value instanceof ICAL.Time) || value.isDate)
                throw new Error(
                  "RDATE com período ou dia inteiro não suportado.",
                );
              const id = p.getParameter("tzid");
              if (
                (typeof id === "string" && id !== baseZone) ||
                (value.zone === ICAL.Timezone.utcTimezone && baseZone !== "UTC")
              )
                throw new Error(
                  "RDATE com fuso diferente da série não suportado.",
                );
              occurrence(value);
            }
          }
        } catch (error) {
          if (error instanceof Error && error.message === "LIMIT_ENTRIES")
            throw error;
          result.entries.splice(beginning);
          issue(
            title,
            error instanceof Error &&
              !/ical|parse|undefined/i.test(error.message)
              ? error.message
              : "Evento inválido no arquivo ICS.",
          );
        }
      }
    }
    const unique = new Map<string, CalendarEntry>();
    const ambiguous = new Set<string>();
    for (const entry of result.entries) {
      const previous = unique.get(entry.source_key);
      if (ambiguous.has(entry.source_key)) {
        issue(
          entry.title,
          "Identificador repetido com horários diferentes; revise o arquivo de origem.",
        );
        continue;
      }
      if (!previous) unique.set(entry.source_key, entry);
      else if (
        previous.starts_at === entry.starts_at &&
        previous.ends_at === entry.ends_at
      )
        issue(
          entry.title,
          "Evento repetido no arquivo: somente a primeira ocorrência foi incluída.",
        );
      else {
        unique.delete(entry.source_key);
        ambiguous.add(entry.source_key);
        issue(
          entry.title,
          "Identificador repetido com horários diferentes; as versões não foram incluídas.",
        );
      }
    }
    result.entries = [...unique.values()].sort(
      (a, b) =>
        a.starts_at.localeCompare(b.starts_at) ||
        a.source_key.localeCompare(b.source_key),
    );
  } catch (error) {
    result.entries = [];
    result.error =
      error instanceof Error && error.message === "LIMIT_ENTRIES"
        ? "Há mais de 200 ocorrências nesse período. Reduza as datas e importe em lotes; nenhum item foi salvo."
        : error instanceof Error && !/ical|parse|undefined/i.test(error.message)
          ? error.message
          : "Não foi possível ler o arquivo. Confira o formato e exporte novamente.";
  }
  return result;
}
