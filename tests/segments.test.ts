import assert from "node:assert/strict";
import { test } from "node:test";
import { niches } from "../src/lib/catalog";
import {
  createDemoAppointment,
  demoClients,
  demoProfessionals,
  segmentBySlug,
} from "../src/lib/segments";
test("public segments describe delivered module scopes and reject unknown slugs", () => {
  assert.equal(segmentBySlug("unknown"), null);
  assert.equal(segmentBySlug("__proto__"), null);
  assert.equal(segmentBySlug("salao")?.available, true);
  assert.equal(segmentBySlug("restaurante")?.available, true);
  assert.match(
    segmentBySlug("restaurante")!.features.join(" "),
    /comandas.*tempo de abertura.*impressão/i,
  );
  assert.match(segmentBySlug("restaurante")!.limitation, /caixa é manual/);
  assert.match(segmentBySlug("salao")!.features.join(" "), /comissões/i);
  assert.match(segmentBySlug("pet-shop")!.features.join(" "), /pets e tutores/);
  assert.match(segmentBySlug("escritorio")!.features.join(" "), /processos/);
  assert.match(
    segmentBySlug("fornecedores")!.features.join(" "),
    /Google Maps/,
  );
  assert.match(
    segmentBySlug("academia")!.features.join(" "),
    /limite de vagas/,
  );
  assert.match(segmentBySlug("logistica")!.limitation, /tempo real/);
  assert.match(segmentBySlug("clinica")!.limitation, /Não inclui prontuário/);
});
for (const niche of niches) {
  test(`demo for ${niche.slug} prevents conflicts, accepts another professional and preserves existing appointments`, () => {
    const segment = segmentBySlug(niche.slug)!;
    assert.ok(segment.features.length > 0, "each niche explains its resources");
    const services = segment.services;
    const input = {
      client: demoClients[0],
      professional: demoProfessionals[0],
      service: services[0],
      time: "11:00",
    };
    const initial: import("../src/lib/segments").DemoAppointment[] = [];
    const added = createDemoAppointment(initial, input, services);
    assert.equal(initial.length, 0);
    assert.ok("appointments" in added);
    const beforeConflict = structuredClone(added.appointments);
    const conflict = createDemoAppointment(added.appointments, input, services);
    assert.ok("error" in conflict);
    assert.deepEqual(added.appointments, beforeConflict);
    const other = createDemoAppointment(
      added.appointments,
      { ...input, professional: demoProfessionals[1] },
      services,
    );
    assert.ok("appointments" in other);
    assert.equal(other.appointments.length, 2);
    assert.deepEqual(added.appointments, beforeConflict);
    const earlier = createDemoAppointment(
      other.appointments,
      { ...input, service: services[1], time: "09:00" },
      services,
    );
    assert.ok("appointments" in earlier);
    assert.deepEqual(
      earlier.appointments.map(({ time }) => time),
      ["09:00", "11:00", "11:00"],
      "The agenda and client history receive appointments in chronological order",
    );
    for (const patch of [
      { client: "real person" },
      { professional: "unknown" },
      { service: "invented" },
      { time: "03:00" },
    ])
      assert.ok(
        "error" in createDemoAppointment([], { ...input, ...patch }, services),
      );
  });
}
