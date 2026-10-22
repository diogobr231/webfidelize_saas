import assert from "node:assert/strict";
import { test } from "node:test";
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
test("demo prevents professional conflicts, accepts another professional and never mutates its input", () => {
  const services = segmentBySlug("salao")!.services;
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
  const conflict = createDemoAppointment(added.appointments, input, services);
  assert.ok("error" in conflict);
  const other = createDemoAppointment(
    added.appointments,
    { ...input, professional: demoProfessionals[1] },
    services,
  );
  assert.ok("appointments" in other);
  assert.equal(other.appointments.length, 2);
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
