import test from "node:test";
import assert from "node:assert/strict";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { authCookieOptions } from "../src/lib/supabase/cookie-options";
import { fakeEmail, fakePassword, startFakeAuth } from "./fixtures/auth-server";

test("SDK login cookies are Secure on configured HTTPS and retain local HTTP sessions", async () => {
  const endpoint = "https://fake.supabase.test";
  const backend = await startFakeAuth(endpoint);
  try {
    for (const [origin, production, secure] of [
      ["https://app.example", true, true],
      ["https://preview.example", false, true],
      ["http://localhost:3000", false, false],
      ["http://127.0.0.1:4123", false, false],
    ] as const) {
      const written: { name: string; value: string; options: CookieOptions }[] =
        [];
      const db = createServerClient(endpoint, "isolated-publishable-key", {
        cookieOptions: authCookieOptions(origin, production),
        auth: { autoRefreshToken: false },
        global: {
          fetch: (input, init) => {
            const url = new URL(
              input instanceof Request ? input.url : String(input),
            );
            assert.equal(url.origin, endpoint);
            return fetch(
              new URL(url.pathname + url.search, backend.origin),
              init,
            );
          },
        },
        cookies: {
          getAll: () => [],
          setAll: (items) => {
            written.push(...items);
          },
        },
      });
      const login = await db.auth.signInWithPassword({
        email: fakeEmail,
        password: fakePassword,
      });
      assert.equal(login.error, null);
      const sessions = written.filter(
        (cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name) && cookie.value,
      );
      assert.ok(sessions.length > 0);
      for (const cookie of sessions) {
        assert.equal(cookie.options.secure, secure);
        assert.equal(cookie.options.sameSite, "lax");
        assert.equal(cookie.options.path, "/");
        assert.equal(cookie.options.httpOnly, false);
      }
    }
  } finally {
    await backend.close();
  }
});

test("cookie security fails closed for invalid deployment origins and production localhost", () => {
  for (const origin of [
    undefined,
    "",
    "http://public.example",
    "https://user:pass@app.example",
    "https://app.example/path",
    "//app.example",
  ])
    assert.throws(() => authCookieOptions(origin), /Invalid APP_URL/);
  assert.throws(
    () => authCookieOptions("http://localhost:3000", true),
    /Invalid APP_URL/,
  );
});
