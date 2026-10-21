import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveBusinessRecordSchema,
  archiveFilter,
  businessContextSchema,
  businessListQuery,
  businessPriceInput,
  businessPriceSchema,
  businessRecordError,
  historyAppointmentTime,
  isBusinessSection,
  relatedBusinessName,
  updateBusinessRecordSchema,
} from "../src/lib/business-records";

test("record routes and filters accept only known sections and archive states", () => {
  assert.equal(isBusinessSection("customers"), true);
  for (const section of [
    "appointments",
    "memberships",
    "__proto__",
    "constructor",
    ["customers"],
    null,
  ])
    assert.equal(isBusinessSection(section), false);
  assert.equal(
    businessContextSchema.safeParse({
      companyId: "other-company",
      section: "customers",
      recordId: "1",
    }).success,
    false,
  );
  for (const value of [undefined, ["todos"], "ativo", "__proto__", ""])
    assert.equal(archiveFilter(value), "ativos");
  assert.equal(archiveFilter("arquivados"), "arquivados");
  assert.equal(archiveFilter("todos"), "todos");
  const query = new URLSearchParams(
    businessListQuery("arquivados", "Ana & Bia", 3),
  );
  assert.equal(query.get("estado"), "arquivados");
  assert.equal(query.get("q"), "Ana & Bia");
  assert.equal(query.get("pagina"), "3");
});

test("record updates validate each section and preserve an explicit optimistic version", () => {
  const customer = updateBusinessRecordSchema.parse({
    section: "customers",
    version: "12",
    name: "  Ana Souza  ",
    phone: " (18) 99999-9999 ",
  });
  assert.deepEqual(customer, {
    section: "customers",
    version: 12,
    name: "Ana Souza",
    phone: "(18) 99999-9999",
  });
  assert.equal(
    updateBusinessRecordSchema.safeParse({
      section: "customers",
      version: "1",
      name: "Ana",
      phone: "1".repeat(31),
    }).success,
    false,
  );
  for (const version of ["0", "-1", "1.5", "1e3", "2147483648", "", 1, null])
    assert.equal(
      updateBusinessRecordSchema.safeParse({
        section: "professionals",
        version,
        name: "Profissional",
      }).success,
      false,
    );
  assert.equal(
    updateBusinessRecordSchema.safeParse({
      section: "professionals",
      version: "1",
      name: " ",
    }).success,
    false,
  );
  for (const duration of ["4", "481", "30.5", "1e2", ""])
    assert.equal(
      updateBusinessRecordSchema.safeParse({
        section: "services",
        version: "1",
        name: "Consulta",
        duration,
        price: "50,00",
      }).success,
      false,
    );
  const service = updateBusinessRecordSchema.parse({
    section: "services",
    version: "1",
    name: "Consulta",
    duration: "30",
    price: "50,05",
  });
  assert.equal(service.section === "services" && service.price, 5005);
});

test("prices use exact cents and reject ambiguous formats or out-of-range values", () => {
  for (const [input, cents] of [
    ["0", 0],
    ["0,01", 1],
    ["19.90", 1990],
    ["1,1", 110],
    ["100000,00", 10000000],
  ] as const)
    assert.equal(businessPriceSchema.parse(input), cents);
  for (const input of [
    "-1",
    "1.234,56",
    "1,234",
    "100000,01",
    "Infinity",
    "1e3",
    "",
    "R$ 50",
    null,
  ])
    assert.equal(businessPriceSchema.safeParse(input).success, false);
  assert.equal(businessPriceInput(5005), "50,05");
  assert.equal(businessPriceInput(0), "0,00");
});

test("archiving and restoring require confirmation and never coerce unchecked booleans", () => {
  assert.deepEqual(
    archiveBusinessRecordSchema.parse({
      version: "2",
      archived: "false",
      confirm_action: "yes",
    }),
    { version: 2, archived: false, confirm_action: "yes" },
  );
  for (const archived of [false, true, "on", "1", ""])
    assert.equal(
      archiveBusinessRecordSchema.safeParse({
        version: "2",
        archived,
        confirm_action: "yes",
      }).success,
      false,
    );
  assert.equal(
    archiveBusinessRecordSchema.safeParse({ version: "2", archived: "true" })
      .success,
    false,
  );
  assert.match(businessRecordError("record version conflict"), /outra aba/);
  assert.match(
    businessRecordError("future scheduled appointments"),
    /em andamento/,
  );
  assert.match(
    businessRecordError("professional limit reached"),
    /limite de profissionais/,
  );
  assert.doesNotMatch(businessRecordError("secret database detail"), /secret/);
});

test("customer history uses the stored interval and São Paulo calendar day", () => {
  const result = historyAppointmentTime(
    "2026-10-20T01:00:00Z",
    "2026-10-20T02:30:00Z",
  );
  assert.ok(result);
  assert.equal(result.day, "2026-10-19");
  assert.equal(result.start, "22:00");
  assert.equal(result.end, "23:30");
  assert.equal(result.minutes, 90);
  assert.equal(historyAppointmentTime("invalid", "2026-10-20T02:30:00Z"), null);
  assert.equal(
    historyAppointmentTime("2026-02-30T10:00:00Z", "2026-03-02T12:00:00Z"),
    null,
  );
  assert.equal(
    historyAppointmentTime("2026-10-20T10:00:00Z", "2026-10-20T09:00:00Z"),
    null,
  );
  assert.equal(relatedBusinessName([{ name: "Nome atual" }]), "Nome atual");
  assert.equal(relatedBusinessName(null), "Cadastro indisponível");
});
