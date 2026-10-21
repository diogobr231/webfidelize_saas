import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { teamInvitationIssueSchema } from "../src/lib/team";

// Existing DEMOs only. No Auth users, email, plans or subscription changes.
const enabled = process.env.TEST_MANAGER_LIVE === "1";
const password = process.env.SEED_PASSWORD;
process.loadEnvFile(".env.local");
let phase = "configuration",
  checks = 0;
class TestFailure extends Error {}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new TestFailure(message);
}
function pass(message: string) {
  checks++;
  console.log(`PASS manager: ${message}`);
}
const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attributes = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
function actionForm(html: string, predicate: (source: string) => boolean) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((m) => m[0])
    .find(predicate);
  check(source, "Expected an authorized Server Action form.");
  const data = new FormData();
  for (const match of source.matchAll(/<input\b[^>]*>/g)) {
    const input = attributes(match[0]);
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  }
  check(
    [...data.keys()].some(
      (key) => key.startsWith("$ACTION_ID_") || key.startsWith("$ACTION_REF_"),
    ),
    "Missing Server Action binding.",
  );
  return data;
}
type Session = { db: SupabaseClient; cookies: Map<string, string> };
function streamedNotFound(source: string) {
  if (
    [...source.matchAll(/<template\b[^>]*>/g)].some(
      (tag) =>
        attributes(tag[0])["data-dgst"] === "NEXT_HTTP_ERROR_FALLBACK;404",
    )
  )
    return true;
  return [
    ...source.matchAll(/self\.__next_f\.push\(([^<]*?)\)<\/script>/g),
  ].some((match) => {
    try {
      const payload: unknown = JSON.parse(match[1]);
      return (
        Array.isArray(payload) &&
        typeof payload[1] === "string" &&
        /(?:^|\n)[\da-f]+:E\{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"(?:,|\})/.test(
          payload[1],
        )
      );
    } catch {
      return false;
    }
  });
}
async function main() {
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    enabled && password && url && key,
    "Opt in with TEST_MANAGER_LIVE and provide the DEMO password through the process.",
  );
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      ["http:", "https:"].includes(base.protocol) &&
      !base.username &&
      !base.password,
    "Only a local application server is permitted.",
  );
  const ownerEmail = "logistica@example.invalid",
    managerEmail = "fornecedores@example.invalid",
    outsiderEmail = "salao@example.invalid";
  function session(): Session {
    const cookies = new Map<string, string>();
    return {
      cookies,
      db: createServerClient(url!, key!, {
        auth: { autoRefreshToken: false },
        cookies: {
          getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
          setAll: (items) => {
            for (const i of items)
              i.value && i.options.maxAge !== 0
                ? cookies.set(i.name, i.value)
                : cookies.delete(i.name);
          },
        },
      }),
    };
  }
  const owner = session(),
    manager = session(),
    outsider = session();
  let companyId = "",
    managerId = "",
    invitationId = "",
    customerId = "",
    acceptedAttempted = false;
  const marker = `TESTE gerente fictício ${randomUUID()}`;
  async function request(client: Session, path: string, body?: FormData) {
    const target = new URL(path, base);
    check(target.origin === base.origin, "Refusing cross-origin credentials.");
    check(
      !body ||
        (companyId && target.pathname.startsWith(`/painel/${companyId}/`)),
      "Only the verified DEMO tenant may receive test writes.",
    );
    const response = await fetch(target, {
      method: body ? "POST" : "GET",
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
      headers: {
        Accept: "text/html",
        Cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body ? { Origin: base.origin, Referer: target.toString() } : {}),
      },
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        at = pair.indexOf("=");
      if (at > 0) {
        const name = pair.slice(0, at),
          value = pair.slice(at + 1);
        value && !/max-age=0(?:;|$)/i.test(header)
          ? client.cookies.set(name, value)
          : client.cookies.delete(name);
      }
    }
    return response;
  }
  async function html(client: Session, path: string) {
    const response = await request(client, path);
    check(response.status === 200, "Expected an authorized page.");
    const source = await response.text();
    check(
      !source.includes('id="__next-page-redirect"'),
      "The expected page redirected.",
    );
    return source;
  }
  async function destination(response: Response) {
    let location = response.headers.get("location");
    if (response.status === 200) {
      const source = await response.text();
      const meta = [...source.matchAll(/<meta\b[^>]*>/g)]
        .map((m) => attributes(m[0]))
        .find(
          (m) =>
            m.id === "__next-page-redirect" &&
            m["http-equiv"]?.toLowerCase() === "refresh",
        );
      location =
        meta?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i)?.[1] || null;
    }
    check(location, "Expected an explicit redirect.");
    const target = new URL(location, base);
    check(target.origin === base.origin, "Unexpected redirect origin.");
    return target;
  }
  async function snapshot(
    db: SupabaseClient,
    table: string,
    company: string,
    fields = "*",
  ) {
    const result = await db
      .from(table)
      .select(fields, { count: "exact" })
      .eq(table === "companies" ? "id" : "company_id", company)
      .order("id")
      .limit(500);
    check(
      !result.error &&
        result.data &&
        result.count !== null &&
        result.count <= 500,
      "Cannot safely read the complete synthetic snapshot.",
    );
    return result.data as unknown as Record<string, unknown>[];
  }
  async function membership() {
    const result = await owner.db
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", managerId)
      .maybeSingle();
    check(!result.error, "Could not inspect the temporary membership.");
    return result.data;
  }
  async function fixture() {
    const result = await owner.db
      .from("customers")
      .select("id,name,phone,record_version,archived_at")
      .eq("company_id", companyId)
      .like("name", `${marker}%`);
    check(
      !result.error && result.data && result.data.length <= 1,
      "Ambiguous synthetic customer state; refusing cleanup.",
    );
    if (result.data[0]) {
      check(
        !customerId || result.data[0].id === customerId,
        "Fixture identity changed unexpectedly.",
      );
      customerId = result.data[0].id;
    }
    return result.data[0] || null;
  }
  try {
    phase = "existing DEMO identities and preflight";
    const signed = await Promise.all([
      owner.db.auth.signInWithPassword({ email: ownerEmail, password }),
      manager.db.auth.signInWithPassword({ email: managerEmail, password }),
      outsider.db.auth.signInWithPassword({ email: outsiderEmail, password }),
    ]);
    check(
      signed.every((r) => !r.error && r.data.user?.email_confirmed_at),
      "Existing confirmed DEMO accounts must authenticate.",
    );
    managerId = signed[1].data.user!.id;
    const ownerCompanies = await owner.db
        .from("companies")
        .select("id,niche,is_demo"),
      managerCompanies = await manager.db
        .from("companies")
        .select("id,niche,is_demo"),
      outsiderCompanies = await outsider.db
        .from("companies")
        .select("id,niche,is_demo");
    check(
      !ownerCompanies.error &&
        ownerCompanies.data?.length === 1 &&
        ownerCompanies.data[0].is_demo === true &&
        ownerCompanies.data[0].niche === "logistica",
      "Expected the original logistics DEMO only.",
    );
    check(
      !managerCompanies.error &&
        managerCompanies.data?.length === 1 &&
        managerCompanies.data[0].is_demo === true &&
        managerCompanies.data[0].niche === "fornecedores",
      "Expected the original supplier DEMO only.",
    );
    check(
      !outsiderCompanies.error &&
        outsiderCompanies.data?.length === 1 &&
        outsiderCompanies.data[0].is_demo === true &&
        outsiderCompanies.data[0].niche === "salao",
      "Expected the original salon DEMO only.",
    );
    companyId = ownerCompanies.data[0].id;
    const foreignId = outsiderCompanies.data[0].id,
      ownId = managerCompanies.data[0].id;
    check(
      new Set([companyId, foreignId, ownId]).size === 3 &&
        !(await membership()),
      "Refusing existing membership or overlapping fixture tenants.",
    );
    const ownMembership = await manager.db
      .from("memberships")
      .select("role")
      .eq("company_id", ownId)
      .eq("user_id", managerId)
      .single();
    check(
      !ownMembership.error && ownMembership.data?.role === "OWNER",
      "The supplier's original owner role must remain intact.",
    );
    const pending = await owner.db
      .from("invitations")
      .select("id,accepted_at,canceled_at,expires_at,last_issued_at")
      .eq("company_id", companyId)
      .eq("email", managerEmail);
    check(
      !pending.error &&
        !pending.data?.some(
          (i) =>
            (!i.accepted_at &&
              !i.canceled_at &&
              Date.parse(i.expires_at) > Date.now()) ||
            Date.parse(i.last_issued_at) > Date.now() - 60000,
        ),
      "A pending/recent invitation exists; refusing interference.",
    );
    check(!(await fixture()), "Synthetic marker must be unused.");
    const companyBefore = await snapshot(owner.db, "companies", companyId),
      ownBefore = await snapshot(manager.db, "companies", ownId);
    const original = new Map<string, Record<string, unknown>[]>();
    for (const table of [
      "customers",
      "services",
      "professionals",
      "appointments",
      "availability",
    ])
      original.set(table, await snapshot(owner.db, table, companyId));
    pass(
      "three distinct DEMOs verified; no preexisting membership or invitation touched",
    );

    phase = "temporary manager invitation without email";
    const issueResult = await owner.db.rpc("create_team_invitation", {
      p_company: companyId,
      p_email: managerEmail,
      p_role: "MANAGER",
    });
    check(!issueResult.error, "The authorized invitation could not be issued.");
    const issue = teamInvitationIssueSchema.safeParse(issueResult.data);
    check(
      issue.success &&
        issue.data.email === managerEmail &&
        issue.data.role === "MANAGER",
      "Unexpected invitation payload.",
    );
    invitationId = issue.data.id;
    acceptedAttempted = true;
    const accepted = await manager.db.rpc("accept_invitation", {
      token: issue.data.token,
    });
    check(
      !accepted.error &&
        accepted.data === companyId &&
        (await membership())?.role === "MANAGER",
      "The temporary manager membership was not accepted.",
    );
    const invitation = await owner.db
      .from("invitations")
      .select("accepted_at,email,role")
      .eq("company_id", companyId)
      .eq("id", invitationId)
      .single();
    check(
      !invitation.error &&
        invitation.data?.accepted_at &&
        invitation.data.email === managerEmail &&
        invitation.data.role === "MANAGER",
      "This exact invitation must be accepted.",
    );
    pass(
      "existing confirmed account joins as MANAGER; no SMTP transport invoked",
    );

    phase = "manager company-wide reads and pages";
    for (const table of original.keys())
      assert.deepEqual(
        await snapshot(manager.db, table, companyId),
        original.get(table),
      );
    for (const path of [
      "",
      "/agenda?view=day",
      "/agenda?view=week",
      "/customers",
      "/services",
      "/professionals",
      "/configuracao",
      "/disponibilidade",
      "/ajuda",
    ]) {
      const source = await html(manager, `/painel/${companyId}${path}`);
      check(
        source.includes("Ambiente de demonstração.") &&
          source.includes("Gerente"),
        "Manager identity or DEMO context was missing.",
      );
    }
    pass(
      "manager reads authorized company CRM/agenda and nine shared HTTP pages",
    );

    phase = "owner-only and foreign-company restrictions";
    const team = await html(manager, `/painel/${companyId}/equipe`);
    check(
      team.includes("Sua conta") &&
        !team.includes(ownerEmail) &&
        !team.includes('name="invitation_id"') &&
        !team.includes('name="member_id"') &&
        !team.includes('name="email"'),
      "Manager team page exposed owner-only data or controls.",
    );
    const deniedBranding = await destination(
      await request(manager, `/painel/${companyId}/personalizacao`),
    );
    check(
      deniedBranding.pathname === `/painel/${companyId}` &&
        deniedBranding.searchParams.get("erro") === "permissao",
      "Manager accessed owner-only personalization.",
    );
    const deniedAdmin = await request(manager, "/admin");
    const adminBody = await deniedAdmin.text();
    check(
      (deniedAdmin.status === 404 ||
        (deniedAdmin.status === 200 && streamedNotFound(adminBody))) &&
        !adminBody.includes("Empresas da plataforma"),
      "Manager accessed platform administration instead of its not-found boundary.",
    );
    const deniedForeign = await destination(
      await request(manager, `/painel/${foreignId}/agenda`),
    );
    check(
      deniedForeign.pathname === "/painel" &&
        deniedForeign.searchParams.get("erro") === "acesso",
      "Manager accessed a third company's agenda.",
    );
    check(
      (await snapshot(manager.db, "customers", foreignId)).length === 0,
      "Manager read foreign customer data.",
    );
    check(
      (await manager.db.rpc("company_team_directory", { c: companyId })).error,
      "Manager read the OWNER directory.",
    );
    check(
      (
        await manager.db.rpc("create_team_invitation", {
          p_company: companyId,
          p_email: "denied-manager@example.invalid",
          p_role: "EMPLOYEE",
        })
      ).error,
      "Manager issued an invitation.",
    );
    check(
      (
        await manager.db.rpc("revoke_company_member", {
          c: companyId,
          member: managerId,
          confirmed: true,
        })
      ).error && (await membership())?.role === "MANAGER",
      "Manager altered membership authority.",
    );
    pass(
      "owner directory/invites/revocation, personalization, admin and foreign tenant remain protected",
    );

    phase =
      "manager creates and edits only its synthetic customer through HTTP";
    const listPath = `/painel/${companyId}/customers`;
    const create = actionForm(
      await html(manager, listPath),
      (form) => form.includes('name="kind"') && form.includes('name="name"'),
    );
    create.set("name", `${marker} criado`);
    create.set("phone", "18900000000");
    const createdResponse = await request(manager, listPath, create);
    const created = await fixture();
    check(
      created && created.name === `${marker} criado` && !created.archived_at,
      "The new synthetic customer was not saved.",
    );
    check(
      (await destination(createdResponse)).searchParams.get("salvo") === "1",
      "Creation lacked persisted success feedback.",
    );
    const detailPath = `${listPath}/${customerId}`;
    const edit = actionForm(await html(manager, detailPath), (form) =>
      form.includes('name="name"'),
    );
    edit.set("name", `${marker} editado`);
    edit.set("phone", "18900000001");
    const editedResponse = await request(manager, detailPath, edit);
    await editedResponse.text();
    const edited = await fixture();
    check(
      edited?.name === `${marker} editado` &&
        edited.phone === "18900000001" &&
        edited.record_version === created.record_version + 1,
      "Manager edit was not persisted with its version.",
    );
    const archive = actionForm(await html(manager, detailPath), (form) =>
      form.includes('name="archived"'),
    );
    archive.set("archived", "true");
    const noConfirm = await request(manager, detailPath, archive);
    await noConfirm.text();
    check(
      !(await fixture())?.archived_at,
      "Archiving without explicit confirmation succeeded.",
    );
    archive.set("confirm_action", "yes");
    const confirmed = await request(manager, detailPath, archive);
    await confirmed.text();
    check((await fixture())?.archived_at, "Confirmed archival failed.");
    pass(
      "MANAGER creates, edits and archives a labeled fixture via Server Actions; confirmation enforced",
    );

    phase = "owner revokes temporary manager through HTTP";
    const revoke = actionForm(
      await html(owner, `/painel/${companyId}/equipe`),
      (form) =>
        form.includes("team-revoke-form") &&
        form.includes(`value="${managerId}"`),
    );
    revoke.set("confirm_action", "yes");
    const revoked = await destination(
      await request(owner, `/painel/${companyId}/equipe`, revoke),
    );
    check(
      revoked.searchParams.get("salvo") === "revogado" && !(await membership()),
      "Temporary manager revocation did not persist.",
    );
    check(
      (await manager.db.auth.getUser()).data.user?.id === managerId,
      "Revoked manager must retain its own authenticated account.",
    );
    for (const table of [
      "companies",
      "customers",
      "services",
      "professionals",
      "appointments",
      "availability",
    ])
      check(
        (await snapshot(manager.db, table, companyId)).length === 0,
        "A still-authenticated revoked manager can read the tenant.",
      );
    const deniedAfter = await destination(
      await request(manager, `/painel/${companyId}/customers`),
    );
    check(
      deniedAfter.pathname === "/painel" &&
        deniedAfter.searchParams.get("erro") === "acesso",
      "Revoked manager still accessed tenant pages.",
    );
    pass("same authenticated manager session loses all revoked tenant access");

    phase = "preservation of original data and owner association";
    for (const [table, before] of original)
      assert.deepEqual(
        (await snapshot(owner.db, table, companyId)).filter(
          (row) => table !== "customers" || row.id !== customerId,
        ),
        before,
      );
    assert.deepEqual(
      await snapshot(owner.db, "companies", companyId),
      companyBefore,
    );
    assert.deepEqual(await snapshot(manager.db, "companies", ownId), ownBefore);
    const remaining = await manager.db
      .from("memberships")
      .select("company_id,role")
      .eq("user_id", managerId);
    check(
      !remaining.error &&
        remaining.data?.length === 1 &&
        remaining.data[0].company_id === ownId &&
        remaining.data[0].role === "OWNER",
      "The manager's original owner association changed.",
    );
    pass(
      "all original business data, owner role and subscription state preserved",
    );
  } finally {
    try {
      if (companyId) {
        const customer = await fixture();
        if (customer && !customer.archived_at) {
          const cleanup = await owner.db.rpc("archive_business_record", {
            p_company: companyId,
            p_section: "customers",
            p_record: customer.id,
            p_version: customer.record_version,
            p_archived: true,
          });
          check(
            !cleanup.error,
            "Cleanup could not archive its uniquely attributable synthetic customer.",
          );
        }
      }
    } finally {
      try {
        if (companyId && invitationId && managerId) {
          const invitation = await owner.db
            .from("invitations")
            .select("accepted_at,canceled_at,email,role")
            .eq("company_id", companyId)
            .eq("id", invitationId)
            .single();
          check(
            !invitation.error &&
              invitation.data?.email === managerEmail &&
              invitation.data.role === "MANAGER",
            "Cleanup cannot attribute the invitation to this run.",
          );
          const current = await membership();
          if (current) {
            check(
              acceptedAttempted &&
                invitation.data.accepted_at &&
                current.role === "MANAGER",
              "Cleanup refuses an unexpected membership.",
            );
            check(
              !(
                await owner.db.rpc("revoke_company_member", {
                  c: companyId,
                  member: managerId,
                  confirmed: true,
                })
              ).error,
              "Cleanup could not revoke its temporary association.",
            );
          } else if (
            !invitation.data.accepted_at &&
            !invitation.data.canceled_at
          ) {
            check(
              !(
                await owner.db.rpc("cancel_team_invitation", {
                  p_company: companyId,
                  p_invitation: invitationId,
                  p_confirmed: true,
                })
              ).error,
              "Cleanup could not cancel its unused invitation.",
            );
          }
        }
      } finally {
        await Promise.allSettled([
          owner.db.auth.signOut({ scope: "local" }),
          manager.db.auth.signOut({ scope: "local" }),
          outsider.db.auth.signOut({ scope: "local" }),
        ]);
      }
    }
  }
  console.log(
    `${checks} MANAGER HTTP/Auth/DB groups passed. Only its archived synthetic customer and invitation audit record remain; no email was sent.`,
  );
}
main().catch((error) => {
  console.error(
    `FAIL manager during ${phase}: ${error instanceof TestFailure ? error.message : "Unexpected failure; details suppressed to protect credentials."}`,
  );
  process.exitCode = 1;
});
