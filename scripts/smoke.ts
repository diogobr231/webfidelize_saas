import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
let checks = 0;
for (const route of [
  "/",
  "/entrar",
  "/cadastro",
  "/recuperar",
  "/entrar/salao",
  "/entrar/pet-shop",
  "/entrar/clinica",
  "/entrar/escritorio",
  "/entrar/restaurante",
  "/entrar/fornecedores",
  "/entrar/logistica",
  "/entrar/academia",
]) {
  const r = await fetch(base + route, { redirect: "manual" });
  assert.equal(r.status, 200, route);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  checks++;
  console.log(`PASS ${route}`);
}
for (const route of [
  "/painel",
  "/admin",
  "/nova-senha",
  "/painel/00000000-0000-4000-8000-000000000001",
]) {
  const r = await fetch(base + route, { redirect: "manual" });
  assert.ok([303, 307].includes(r.status), `${route}: ${r.status}`);
  assert.ok(r.headers.get("location")?.startsWith("/entrar"));
  checks++;
  console.log(`PASS unauthenticated blocked ${route}`);
}
assert.equal((await fetch(base + "/entrar/nicho-inexistente")).status, 404);
checks++;
const home = await (await fetch(base)).text();
assert.ok(home.includes("5518997695445"));
assert.ok(home.includes("Demonstração visual"));
checks++;
console.log(
  `${checks} HTTP smoke checks passed. Does not validate authenticated E2E or email delivery.`,
);
