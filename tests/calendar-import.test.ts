import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  calendarInstant,
  parseCalendarFile,
  readCsv,
  type CalendarImportOptions,
} from "../src/lib/calendar-import";

const options: CalendarImportOptions = {
  from: "2026-10-01",
  to: "2026-10-31",
  timezone: "America/Sao_Paulo",
  dateOrder: "br",
};
const calendar = (events: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
const event = (body: string) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`;
const sample = (extra = "") =>
  event(
    `UID:qa-fixture\r\nDTSTART;TZID=America/Sao_Paulo:20261005T090000\r\nDTEND;TZID=America/Sao_Paulo:20261005T100000\r\nSUMMARY:Compromisso sintético${extra ? "\r\n" + extra : ""}`,
  );
const parse = (text: string, patch: Partial<CalendarImportOptions> = {}) =>
  parseCalendarFile(text, "ics", { ...options, ...patch });

test("ICS respects declared zones, folded/escaped titles, and stable IDs across file order", () => {
  const text = sample().replace(
    "SUMMARY:Compromisso sintético",
    "SUMMARY:Compromisso\\, sintético e\r\n  longo",
  );
  const result = parse(calendar(text));
  assert.equal(result.error, undefined);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].starts_at, "2026-10-05T12:00:00.000Z");
  assert.equal(result.entries[0].ends_at, "2026-10-05T13:00:00.000Z");
  assert.equal(result.entries[0].title, "Compromisso, sintético e longo");
  assert.match(result.entries[0].source_key, /^[a-f0-9]{64}$/);
  assert.equal(
    parse(calendar(text.replace("SUMMARY:", "DESCRIPTION:Unused\r\nSUMMARY:")))
      .entries[0].source_key,
    result.entries[0].source_key,
  );
});
test("ICS supports UTC and floating local times without server timezone dependence", () => {
  const utc = event(
    "UID:utc\r\nDTSTART:20261005T120000Z\r\nDTEND:20261005T130000Z",
  );
  const local = event("UID:local\r\nDTSTART:20261005T090000\r\nDURATION:PT1H");
  const result = parse(calendar(utc + "\r\n" + local));
  assert.equal(result.entries.length, 2);
  for (const entry of result.entries) {
    assert.equal(entry.starts_at, "2026-10-05T12:00:00.000Z");
    assert.equal(entry.ends_at, "2026-10-05T13:00:00.000Z");
  }
});
test("weekly recurrence honors BYDAY, COUNT, EXDATE, moved exceptions and canceled instances", () => {
  const master = sample(
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r\nEXDATE;TZID=America/Sao_Paulo:20261007T090000",
  );
  const moved = event(
    "UID:qa-fixture\r\nRECURRENCE-ID;TZID=America/Sao_Paulo:20261012T090000\r\nDTSTART;TZID=America/Sao_Paulo:20261013T150000\r\nDTEND;TZID=America/Sao_Paulo:20261013T160000\r\nSUMMARY:Remarcado",
  );
  const canceled = event(
    "UID:qa-fixture\r\nRECURRENCE-ID;TZID=America/Sao_Paulo:20261014T090000\r\nSTATUS:CANCELLED",
  );
  const result = parse(calendar([master, moved, canceled].join("\r\n")));
  assert.equal(result.error, undefined);
  assert.equal(result.entries.length, 4);
  assert.deepEqual(
    result.entries.map((e) => e.starts_at),
    [
      "2026-10-05T12:00:00.000Z",
      "2026-10-13T18:00:00.000Z",
      "2026-10-19T12:00:00.000Z",
      "2026-10-21T12:00:00.000Z",
    ],
  );
  assert.ok(result.issues.some((i) => /cancelada/.test(i.reason)));
  const old = parse(calendar(master)).entries.find(
    (e) => e.starts_at === "2026-10-12T12:00:00.000Z",
  );
  assert.equal(result.entries[1].source_key, old?.source_key);
});
test("daily UNTIL is inclusive in its explicit UTC timezone and interval is respected", () => {
  const result = parse(
    calendar(sample("RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261009T120000Z")),
  );
  assert.deepEqual(
    result.entries.map((e) => e.starts_at),
    [
      "2026-10-05T12:00:00.000Z",
      "2026-10-07T12:00:00.000Z",
      "2026-10-09T12:00:00.000Z",
    ],
  );
});
test("weekly timezone recurrence preserves local hour through DST with runtime IANA data", () => {
  const source = event(
    "UID:dst\r\nDTSTART;TZID=America/New_York:20261026T090000\r\nDTEND;TZID=America/New_York:20261026T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3",
  );
  const result = parse(calendar(source), { to: "2026-11-30" });
  assert.deepEqual(
    result.entries.map((e) => e.starts_at),
    [
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-09T14:00:00.000Z",
    ],
  );
});
test("moved exceptions are kept even when original occurrence was outside the selected period", () => {
  const master = sample("RRULE:FREQ=WEEKLY;COUNT=2");
  const moved = event(
    "UID:qa-fixture\r\nRECURRENCE-ID;TZID=America/Sao_Paulo:20261012T090000\r\nDTSTART;TZID=America/Sao_Paulo:20261103T090000\r\nDTEND;TZID=America/Sao_Paulo:20261103T100000",
  );
  const result = parse(calendar(master + "\r\n" + moved), {
    from: "2026-11-01",
    to: "2026-11-30",
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].starts_at, "2026-11-03T12:00:00.000Z");
});
test("all-day, transparent, canceled, unknown timezone and unsupported recurrence have explicit reasons", () => {
  const cases = [
    event(
      "UID:allday\r\nDTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006",
    ),
    sample("TRANSP:TRANSPARENT"),
    sample("STATUS:CANCELLED"),
    sample().replaceAll("America/Sao_Paulo", "Custom/Unsupported"),
    sample("RRULE:FREQ=MINUTELY;INTERVAL=1"),
    sample("RRULE:FREQ=MONTHLY;COUNT=4"),
    sample("RRULE:FREQ=WEEKLY;BYHOUR=8,9;COUNT=4"),
  ];
  for (const source of cases) {
    const result = parse(calendar(source));
    assert.equal(result.entries.length, 0);
    assert.ok(result.issueCount > 0);
    assert.ok(result.issues[0].reason.length > 10);
  }
});
test("THISANDFUTURE and duplicate masters reject the complete series instead of partial incorrect imports", () => {
  const range = event(
    "UID:qa-fixture\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261012T090000\r\nDTSTART:20261012T100000\r\nDTEND:20261012T110000",
  );
  for (const source of [
    sample("RRULE:FREQ=WEEKLY") + "\r\n" + range,
    sample() + "\r\n" + sample(),
  ]) {
    const result = parse(calendar(source));
    assert.equal(result.entries.length, 0);
    assert.ok(result.issueCount > 0 || result.error);
  }
});
test("unreachable daily weekday rules are rejected before ICAL.js can loop internally", () => {
  const source = `import assert from 'node:assert/strict'; import {parseCalendarFile} from './src/lib/calendar-import.ts';
    const result = parseCalendarFile(${JSON.stringify(calendar(sample("RRULE:FREQ=DAILY;INTERVAL=7;BYDAY=TU;COUNT=2")))}, 'ics', ${JSON.stringify(options)});
    assert.equal(result.entries.length,0);assert.ok(result.issues.some(i=>/semanal/.test(i.reason)));`;
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(
    run.error,
    undefined,
    "Parser must complete without reaching the subprocess timeout.",
  );
  assert.equal(run.status, 0, run.stderr);
});
test("RDATE and EXDATE produce unique bounded occurrences", () => {
  const result = parse(
    calendar(
      sample(
        "RDATE;TZID=America/Sao_Paulo:20261006T090000,20261006T090000,20261007T090000\r\nEXDATE;TZID=America/Sao_Paulo:20261007T090000",
      ),
    ),
  );
  assert.deepEqual(
    result.entries.map((e) => e.starts_at),
    ["2026-10-05T12:00:00.000Z", "2026-10-06T12:00:00.000Z"],
  );
});
test("excess entries, bytes, nesting and invalid windows fail the whole preview", () => {
  const events = Array.from({ length: 201 }, (_, i) =>
    sample().replace("UID:qa-fixture", `UID:qa-${i}`),
  ).join("\r\n");
  const tooMany = parse(calendar(events));
  assert.match(tooMany.error || "", /200/);
  assert.equal(tooMany.entries.length, 0);
  assert.match(parse("x".repeat(1024 * 1024 + 1)).error || "", /1 MB/);
  assert.ok(parse(calendar(sample()), { to: "2027-10-31" }).error);
  assert.ok(parse(calendar("BEGIN:X\r\n".repeat(15))).error);
});
test("DST ambiguous/skipped local hours and impossible calendar dates are rejected", () => {
  for (const wall of [
    { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
    { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
  ])
    assert.throws(() => calendarInstant(wall, "America/New_York"), /ambíguo/);
  assert.throws(
    () =>
      calendarInstant(
        { year: 2026, month: 2, day: 30, hour: 10, minute: 0, second: 0 },
        "UTC",
      ),
    /inválida/,
  );
});
test("CSV parses semicolon, quoted delimiters/newlines, BOM and mapped Brazilian date/time columns", () => {
  const source =
    '\uFEFFTítulo;Data;Hora início;Hora fim;ID\r\n"Cliente; sintético\nlinha";05/10/2026;09:00;10:00;qa-csv';
  const result = parseCalendarFile(source, "csv", options);
  assert.equal(result.error, undefined);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].starts_at, "2026-10-05T12:00:00.000Z");
  assert.equal(result.entries[0].title, "Cliente; sintético linha");
  assert.equal(
    parseCalendarFile(
      source.replace("09:00", "11:00").replace("10:00", "12:00"),
      "csv",
      options,
    ).entries[0].source_key,
    result.entries[0].source_key,
  );
});
test("CSV supports ISO offset timestamps and explicitly selected American dates", () => {
  const iso = parseCalendarFile(
    "title,starts_at,ends_at\nQA,2026-10-05T09:00:00-03:00,2026-10-05T10:00:00-03:00",
    "csv",
    options,
  );
  assert.equal(iso.entries[0].starts_at, "2026-10-05T12:00:00.000Z");
  const us = parseCalendarFile(
    "Subject,Start Date,Start Time,End Date,End Time\nQA,10/05/2026,9:00 AM,10/05/2026,10:00 AM",
    "csv",
    { ...options, dateOrder: "us" },
  );
  assert.equal(us.entries[0].starts_at, "2026-10-05T12:00:00.000Z");
});
test("CSV unknown headers return mapping controls, malformed rows remain explicit exclusions", () => {
  const unmapped = parseCalendarFile(
    "Nome,Quando,Termino\nQA,2026-10-05 09:00,2026-10-05 10:00",
    "csv",
    options,
  );
  assert.ok(unmapped.error);
  assert.equal(unmapped.headers.length, 3);
  const mapped = parseCalendarFile(
    "Nome,Quando,Termino\nQA,2026-10-05 09:00,2026-10-05 10:00\nWrong,2026-10-06 09:00",
    "csv",
    {
      ...options,
      columns: {
        title: 0,
        start: 1,
        end: 2,
        startTime: -1,
        endTime: -1,
        id: -1,
        allDay: -1,
      },
    },
  );
  assert.equal(mapped.entries.length, 1);
  assert.equal(mapped.issueCount, 1);
  assert.throws(() => readCsv('a,b\n"unfinished'), /aspas/);
});
test("CSV does not execute formula titles and rejects all-day, reversed or >31-day intervals", () => {
  const formula = parseCalendarFile(
    'title,start,end\n=HYPERLINK(""),2026-10-05 09:00,2026-10-05 10:00',
    "csv",
    options,
  );
  assert.equal(formula.entries[0].title, '=HYPERLINK("")');
  for (const source of [
    "title,start,end,allDay\nQA,2026-10-05,2026-10-06,true",
    "title,start,end\nQA,2026-10-05 10:00,2026-10-05 09:00",
    "title,start,end\nQA,2026-10-05 09:00,2026-12-05 10:00",
  ]) {
    const result = parseCalendarFile(source, "csv", options);
    assert.equal(result.entries.length, 0);
    assert.equal(result.issueCount, 1);
  }
});
test("CSV duplicate IDs are reviewable without locking selection to ambiguous rows", () => {
  const header = "id,title,start,end\n";
  const row = "qa,Example,2026-10-05 09:00,2026-10-05 10:00";
  const identical = parseCalendarFile(
    header + row + "\n" + row,
    "csv",
    options,
  );
  assert.equal(identical.entries.length, 1);
  assert.equal(identical.issueCount, 1);
  const ambiguous = parseCalendarFile(
    header +
      row +
      "\n" +
      row.replace("09:00", "11:00").replace("10:00", "12:00"),
    "csv",
    options,
  );
  assert.equal(ambiguous.entries.length, 0);
  assert.match(ambiguous.issues[0].reason, /diferentes/);
});
test("RDATE with another timezone is explicitly rejected instead of shifting the appointment", () => {
  const result = parse(calendar(sample("RDATE:20261006T120000Z")));
  assert.equal(result.entries.length, 0);
  assert.match(result.issues[0].reason, /fuso diferente/);
});
test("CSV delimiter inference ignores punctuation inside quoted headers and rejects 24:00 rollover", () => {
  assert.deepEqual(
    readCsv('"title;with;semicolons;inside",start,end\nQA,one,two')[0],
    ["title;with;semicolons;inside", "start", "end"],
  );
  const invalid = parseCalendarFile(
    "title,start,end\nQA,2026-10-05T24:00:00Z,2026-10-06T01:00:00Z",
    "csv",
    options,
  );
  assert.equal(invalid.entries.length, 0);
  assert.equal(invalid.issueCount, 1);
});
test("recurrence rejects excessive BYDAY entries and extreme numeric parameters before iteration", () => {
  for (const rule of [
    "FREQ=WEEKLY;BYDAY=" + Array(1000).fill("MO").join(","),
    "FREQ=DAILY;COUNT=1000000000",
    "FREQ=WEEKLY;INTERVAL=999999",
  ]) {
    const result = parse(calendar(sample("RRULE:" + rule)));
    assert.equal(result.entries.length, 0);
    assert.ok(result.issueCount > 0 || result.error);
  }
});
test("large RDATE and EXDATE lists are rejected before timezone work", () => {
  for (const field of ["RDATE", "EXDATE"]) {
    const result = parse(
      calendar(
        sample(field + ":" + Array(2001).fill("20261006T120000Z").join(",")),
      ),
    );
    assert.equal(result.entries.length, 0);
    assert.match(result.error || "", /2.000/);
  }
});
