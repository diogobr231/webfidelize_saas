import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await originalFetch(input, init);
    } catch (error) {
      last = error;
    }
  }
  throw last;
};
process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  password = process.env.SEED_PASSWORD;
if (!password)
  throw new Error(
    "Set SEED_PASSWORD in the process environment; never commit it.",
  );
if(!process.env.ADMIN_EMAIL)throw new Error('Set ADMIN_EMAIL in the process environment.');
const niches = [
  "salao",
  "pet-shop",
  "clinica",
  "escritorio",
  "restaurante",
  "fornecedores",
  "logistica",
  "academia",
];
for (const niche of niches) {
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await db.auth.signInWithPassword({
    email: `${niche}@example.invalid`,
    password,
  });
  assert.equal(login.error, null, `Auth ${niche}`);
  const { data, error } = await db.from("companies").select("id,niche,is_demo");
  assert.equal(error, null);
  assert.equal(data?.length, 1);
  assert.equal(data[0].niche, niche);
  assert.equal(data[0].is_demo, true);
  const customers = await db.from("customers").select("company_id,name");
  assert.equal(customers.error, null);
  assert.ok(customers.data!.length >= 2);
  assert.ok(customers.data!.every((c) => c.company_id === data[0].id));
  const publicCatalog = await db.rpc("public_catalog", {
    slug: `demo-${niche}`,
  });
  assert.equal(publicCatalog.error, null);
  assert.equal(publicCatalog.data.is_demo, true);
  assert.equal((await db.rpc("is_super_admin")).data, false);
  await db.auth.signOut({ scope: "local" });
  console.log(
    `PASS ${niche}: Auth, tenant isolation, demo CRM and public catalogue`,
  );
}
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
assert.equal(
  (
    await admin.auth.signInWithPassword({
      email: process.env.ADMIN_EMAIL!,
      password,
    })
  ).error,
  null,
);
assert.equal((await admin.rpc("is_super_admin")).data, true);
await admin.auth.signOut({ scope: "local" });
console.log("PASS administrator Auth and SUPER_ADMIN role");
