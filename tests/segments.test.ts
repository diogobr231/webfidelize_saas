import assert from "node:assert/strict";
import { test } from "node:test";
import { niches } from "../src/lib/catalog";
import {
  createDemoAppointment,
  demoClients,
  demoProfessionals,
  segmentBySlug,
} from "../src/lib/segments";
test("public segments distinguish available core from planned modules and reject unknown slugs", () => {
  assert.equal(segmentBySlug("unknown"), null);
  assert.equal(segmentBySlug("__proto__"), null);
  assert.equal(segmentBySlug("salao")?.available, true);
  assert.equal(segmentBySlug("restaurante")?.available, false);
  assert.match(segmentBySlug("clinica")!.limitation, /Não inclui prontuário/);
});
for (const niche of niches) {
  test(`demo for ${niche.slug} prevents conflicts, accepts another professional and preserves existing appointments`, () => {
    const services = segmentBySlug(niche.slug)!.services;
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
