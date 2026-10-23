import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { AddressInfo } from "node:net";

export const confirmationHash = "ab".repeat(28);
export const onboardingConfirmationHash = "ef".repeat(28);
export const recoveryHash = `pkce_${"cd".repeat(28)}`;
export const fakeEmail = "auth-flow@example.invalid";
export const fakePassword = "Local-Test-Password-Only!";

export async function startFakeAuth(issuerOrigin: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "isolated-auth-test",
    alg: "ES256",
    use: "sig",
  };
  const user = {
    id: "c40e7fd9-9671-44ca-b4aa-3b4f30316017",
    aud: "authenticated",
    role: "authenticated",
    email: fakeEmail,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const sessions = new Map<string, ReturnType<typeof newSession>>();
  const state = {
    fault: "" as "" | "smtp" | "limit",
    verifyCalls: 0,
    passwordChanges: 0,
    signupCalls: 0,
    recoveryCalls: 0,
    resendCalls: 0,
    jwksCalls: 0,
    password: fakePassword,
    usedTokens: new Set<string>(),
    company: null as null | Record<string, unknown>,
    companyCreations: 0,
    services: [] as Record<string, unknown>[],
    professionals: [] as Record<string, unknown>[],
  };
  function newSession(method: "otp" | "recovery" | "password") {
    const seconds = Math.floor(Date.now() / 1000);
    const sessionId = randomUUID();
    const claims = {
      iss: `${issuerOrigin}/auth/v1`,
      aud: "authenticated",
      sub: user.id,
      role: "authenticated",
      aal: "aal1",
      email: user.email,
      iat: seconds,
      exp: seconds + 3600,
      session_id: sessionId,
      amr: [{ method, timestamp: seconds }],
    };
    const header = Buffer.from(
      JSON.stringify({ alg: "ES256", typ: "JWT", kid: jwk.kid }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return {
      access_token: `${header}.${payload}.${signature}`,
      refresh_token: randomUUID(),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: seconds + 3600,
      user,
      sessionId,
    };
  }
  function session(method: "otp" | "recovery" | "password") {
    const result = newSession(method);
    sessions.set(result.access_token, result);
    return result;
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      /* Empty GET bodies. */
    }
    const send = (status: number, data: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Supabase-Api-Version": "2024-01-01",
      });
      response.end(JSON.stringify(data));
    };
    const fail = (status: number, code: string) =>
      send(status, { code, msg: "Controlled isolated Auth response" });
    const token = request.headers.authorization?.replace(/^Bearer /, "") || "";
    const current = sessions.get(token);
    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      state.jwksCalls++;
      return send(200, { keys: [jwk] });
    }
    if (url.pathname === "/auth/v1/user") {
      if (!current) return fail(401, "bad_jwt");
      if (request.method === "PUT") {
        state.passwordChanges++;
        state.password = String(body.password);
      }
      return send(200, user);
    }
    if (url.pathname === "/auth/v1/logout") {
      sessions.delete(token);
      response.writeHead(204);
      return response.end();
    }
    if (
      ["/auth/v1/signup", "/auth/v1/recover", "/auth/v1/resend"].includes(
        url.pathname,
      )
    ) {
      if (
        typeof body.email !== "string" ||
        !body.email.endsWith("@example.invalid")
      )
        return fail(400, "invalid_test_email");
      if (url.pathname.endsWith("signup")) state.signupCalls++;
      if (url.pathname.endsWith("recover")) state.recoveryCalls++;
      if (url.pathname.endsWith("resend")) state.resendCalls++;
      if (state.fault === "smtp") return fail(500, "unexpected_failure");
      if (state.fault === "limit")
        return fail(429, "over_email_send_rate_limit");
      return send(
        200,
        url.pathname.endsWith("signup")
          ? { user: { ...user, email_confirmed_at: undefined }, session: null }
          : {},
      );
    }
    if (url.pathname === "/auth/v1/verify") {
      state.verifyCalls++;
      const hash = String(body.token_hash);
      const correct =
        ((hash === confirmationHash || hash === onboardingConfirmationHash) &&
          body.type === "email") ||
        (hash === recoveryHash && body.type === "recovery");
      if (!correct || state.usedTokens.has(hash))
        return fail(403, "otp_expired");
      state.usedTokens.add(hash);
      // Supabase Auth verifyPost currently emits AMR otp even for recovery.
      return send(200, session("otp"));
    }
    if (url.pathname === "/auth/v1/token") {
      if (url.searchParams.get("grant_type") === "password") {
        if (body.email !== fakeEmail || body.password !== state.password)
          return fail(400, "invalid_credentials");
        return send(200, session("password"));
      }
      if (url.searchParams.get("grant_type") === "pkce") {
        if (
          typeof body.code_verifier !== "string" ||
          body.code_verifier.length < 43
        )
          return fail(400, "bad_code_verifier");
        if (body.auth_code === "legacy-recovery")
          return send(200, session("recovery"));
        if (body.auth_code === "legacy-signup")
          return send(200, session("otp"));
      }
      return fail(400, "invalid_grant");
    }
    if (url.pathname === "/rest/v1/rpc/is_super_admin") return send(200, false);
    // Only the isolated HTTP journey uses these rows. SQL suites independently
    // verify the real create_company implementation, RLS and server expiry.
    if (url.pathname === "/rest/v1/rpc/create_company") {
      if (!current) return fail(401, "unauthorized");
      if (state.company) return fail(409, "owner_already_has_company");
      state.companyCreations++;
      state.company = {
        id: "5225ae76-7610-408e-8e78-d2ab42c094b6",
        name: body.company_name,
        niche: body.company_niche,
        plan_id: "essencial",
        status: "trialing",
        trial_card_required: false,
        trial_ends_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        booking_enabled: false,
        booking_slug: null,
        is_demo: true,
      };
      return send(200, state.company.id);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      if (!current) return fail(401, "unauthorized");
      const table = url.pathname.slice("/rest/v1/".length);
      const membership = state.company
        ? { company_id: state.company.id, user_id: user.id, role: "OWNER" }
        : null;
      const single = request.headers.accept?.includes("vnd.pgrst.object");
      const rows = (items: unknown[]) => {
        response.setHeader(
          "Content-Range",
          `0-${Math.max(0, items.length - 1)}/${items.length}`,
        );
        return send(200, single ? (items[0] ?? null) : items);
      };
      if (table === "memberships") return rows(membership ? [membership] : []);
      if (table === "companies")
        return rows(state.company ? [state.company] : []);
      if (table === "plans")
        return rows([{ id: "essencial", name: "Essencial", staff_limit: 1 }]);
      if (table === "services" || table === "professionals") {
        const records = state[table];
        if (request.method === "POST") {
          if (
            !state.company ||
            state.company.status !== "trialing" ||
            Date.parse(String(state.company.trial_ends_at)) <= Date.now()
          )
            return fail(403, "trial_expired");
          records.push({ ...body, archived_at: null });
          return send(201, null);
        }
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        return rows(records.filter((record) => !id || record.id === id));
      }
      if (table === "rpc/executive_dashboard") {
        const totals = {
          appointments: 0,
          scheduled: 0,
          completed: 0,
          canceled: 0,
          attended_customers: 0,
        };
        return send(200, {
          scope: "company",
          current: totals,
          previous: totals,
          customers: {
            total: 0,
            new: 0,
            previous_new: 0,
            without_created_at: 0,
          },
          daily: [],
          financial_available: false,
        });
      }
      return rows([]);
    }
    return fail(404, "unexpected_test_request");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    state,
    session,
    user,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
