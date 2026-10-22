import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("AI detects request-scoped Vercel OIDC and refuses an unconfigured worker before database access", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import assert from 'node:assert/strict';
       import { aiProviderConfigured } from './src/lib/admin-ai/provider.ts';
       import { processAdminAi } from './src/lib/admin-ai/server.ts';
       delete process.env.AI_GATEWAY_API_KEY;
       delete process.env.VERCEL_OIDC_TOKEN;
       const symbol = Symbol.for('@vercel/request-context');
       delete globalThis[symbol];
       assert.equal(aiProviderConfigured(), false);
       process.env.AI_WORKER_SECRET = 'isolated-worker-fixture-01234567890123456789';
       await assert.rejects(processAdminAi('manual'), /AI_PROVIDER_CONFIGURATION/);
       process.env.VERCEL_OIDC_TOKEN = 'isolated-local-token';
       assert.equal(aiProviderConfigured(), true);
       delete process.env.VERCEL_OIDC_TOKEN;
       globalThis[symbol] = { get: () => ({ headers: { 'x-vercel-oidc-token': 'isolated-request-token' } }) };
       assert.equal(aiProviderConfigured(), true);
       delete globalThis[symbol];
       assert.equal(aiProviderConfigured(), false);
       process.env.AI_GATEWAY_API_KEY = 'isolated-api-key';
       assert.equal(aiProviderConfigured(), true);
       console.log('PASS');`,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(output.trim(), "PASS");
});
