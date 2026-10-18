import test from "node:test";
import assert from "node:assert/strict";
import {
  setupDestination,
  setupProfessionalSchema,
  setupProgress,
  setupServiceSchema,
  setupStep,
} from "../src/lib/onboarding";

const recordId = "00000000-0000-4000-8000-000000000001";
const service = {
  record_id: recordId,
  name: "Atendimento de teste",
  duration: "30",
  price: "69,90",
};

test("first setup starts with the company and cannot count unscoped records as progress", () => {
  const empty = setupProgress(false, 0, 0);
  assert.equal(empty.next, "empresa");
  assert.equal(empty.done, 0);
  assert.equal(empty.percent, 0);
  assert.deepEqual(setupProgress(false, 12, 5), empty);
});

test("resuming uses saved records, including work completed outside the wizard", () => {
  const saved = {
    company: true,
    services: [{ id: "saved-service" }],
    professionals: [] as { id: string }[],
  };
  const beforeReload = setupProgress(
    saved.company,
    saved.services.length,
    saved.professionals.length,
  );
  assert.equal(beforeReload.next, "equipe");
  assert.equal(beforeReload.done, 2);
  assert.equal(beforeReload.percent, 67);
  const reloaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
  assert.deepEqual(
    setupProgress(
      reloaded.company,
      reloaded.services.length,
      reloaded.professionals.length,
    ),
    beforeReload,
  );

  reloaded.professionals.push({ id: "saved-professional" });
  assert.equal(
    setupProgress(true, 1, reloaded.professionals.length).percent,
    100,
  );
  assert.equal(
    setupProgress(true, 1, reloaded.professionals.length).next,
    "resumo",
  );
  const missingService = setupProgress(true, 0, 1);
  assert.equal(missingService.next, "servicos");
  assert.equal(missingService.done, 2);
});

test("untrusted step values fall back without becoming an external return URL", () => {
  for (const value of [
    undefined,
    null,
    "",
    "https://example.invalid",
    "//example.invalid",
    "/admin",
    "../resumo",
    ["servicos"],
    { toString: () => "servicos" },
  ]) {
    const step = setupStep(value, "servicos");
    assert.equal(step, "servicos");
    const target = new URL(
      setupDestination(recordId, step),
      "https://app.example.invalid",
    );
    assert.equal(target.origin, "https://app.example.invalid");
    assert.equal(target.pathname, `/painel/${recordId}/configuracao`);
    assert.equal(target.searchParams.get("etapa"), "servicos");
  }
  assert.equal(setupStep("equipe", "servicos"), "equipe");
  const paused = new URL(
    setupDestination(recordId, "equipe", true),
    "https://app.example.invalid",
  );
  assert.equal(paused.pathname, `/painel/${recordId}`);
  assert.equal(paused.searchParams.get("configuracao"), "pausada");
  assert.equal(paused.searchParams.has("etapa"), false);
});

test("Brazilian prices persist exact integer cents and allow explicit free services", () => {
  for (const [price, cents] of [
    ["0", 0],
    ["0,01", 1],
    ["1,1", 110],
    ["69,90", 6990],
    ["69.90", 6990],
    [" 99,99 ", 9999],
    ["100000,00", 10000000],
  ] as const) {
    const parsed = setupServiceSchema.parse({
      ...service,
      price,
      name: "  Atendimento de teste  ",
    });
    assert.equal(parsed.price, cents);
    assert.equal(parsed.name, "Atendimento de teste");
    assert.equal(parsed.duration, 30);
    assert.equal(parsed.record_id, recordId);
  }
});

test("ambiguous, missing, negative or over-limit prices cannot create a service", () => {
  for (const price of [
    "",
    " ",
    "-1",
    "1,005",
    "1.005",
    "1.000,00",
    "1,000.00",
    "R$ 10,00",
    "1e3",
    "Infinity",
    "100000,01",
    "999999",
    undefined,
    null,
    20,
  ]) {
    assert.equal(
      setupServiceSchema.safeParse({ ...service, price }).success,
      false,
    );
  }
});

test("service durations and names are validated before a guided save", () => {
  for (const duration of ["", "0", "4", "481", "30.5", "NaN", undefined]) {
    assert.equal(
      setupServiceSchema.safeParse({ ...service, duration }).success,
      false,
    );
  }
  for (const duration of ["5", "480"]) {
    assert.equal(
      setupServiceSchema.safeParse({ ...service, duration }).success,
      true,
    );
  }
  for (const name of [" ", "A", "A".repeat(121)]) {
    assert.equal(
      setupServiceSchema.safeParse({ ...service, name }).success,
      false,
    );
  }
});

test("professional identity is explicit so retries can reuse the same record", () => {
  const input = { record_id: recordId, name: "  Profissional de teste  " };
  assert.deepEqual(setupProfessionalSchema.parse(input), {
    record_id: recordId,
    name: "Profissional de teste",
  });
  assert.equal(
    setupProfessionalSchema.safeParse({ ...input, record_id: "invalid" })
      .success,
    false,
  );
  assert.equal(
    setupProfessionalSchema.safeParse({ name: input.name }).success,
    false,
  );
  assert.equal(
    setupProfessionalSchema.safeParse({ ...input, name: " " }).success,
    false,
  );
});
