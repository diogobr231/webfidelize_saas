import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

// Synthetic tenants only; no email is sent and no appointment is created.
const optedIn = process.env.TEST_TEAM_LIVE === "1";
const password = process.env.SEED_PASSWORD;
process.loadEnvFile(".env.local");
let phase = "configuration",
  checks = 0;
class TestFailure extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
function pass(message: string) {
  checks++;
  console.log(`PASS team live: ${message}`);
}
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function attributes(tag: string) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w$:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [
      m[1],
      decode(m[2]),
    ]),
  );
}
function formInputs(source: string) {
  return [...source.matchAll(/<input\b[^>]*>/g)].map((match) =>
    attributes(match[0]),
  );
}
function actionForm(
  html: string,
  predicate: (inputs: Record<string, string>[], source: string) => boolean,
) {
  const source = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((form) => predicate(formInputs(form), form));
  check(source, "Expected team form was not rendered.");
  const data = new FormData();
  for (const input of formInputs(source))
    if (input.type === "hidden" && input.name)
      data.append(input.name, input.value || "");
  check(
    [...data.keys()].some(
      (key) => key.startsWith("$ACTION_ID_") || key.startsWith("$ACTION_REF_"),
    ),
    "Server Action bindings were absent.",
  );
  return data;
}
function cloneForm(source: FormData) {
  const form = new FormData();
  for (const [key, value] of source) form.append(key, value);
  return form;
}
type TestSession = { db: SupabaseClient; cookies: Map<string, string> };

async function main() {
  check(
    optedIn,
    "Set TEST_TEAM_LIVE=1 to allow the explicit synthetic team test.",
  );
  const base = new URL(process.env.TEST_BASE_URL || "http://localhost:3000");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  check(
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) &&
      !base.username &&
      !base.password,
    "Use a local application server without URL credentials.",
  );
  check(
    password && supabaseUrl && key,
    "Configure public Supabase settings and provide SEED_PASSWORD through the process.",
  );
  // Keep the identities fixed so reruns never drift to a real account.
  const ownerEmail = "logistica@example.invalid",
    employeeEmail = "fornecedores@example.invalid";
  function session(): TestSession {
    const cookies = new Map<string, string>();
    const db = createServerClient(supabaseUrl!, key!, {
      auth: { autoRefreshToken: false },
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (items) => {
          for (const item of items)
            item.value && item.options.maxAge !== 0
              ? cookies.set(item.name, item.value)
              : cookies.delete(item.name);
        },
      },
    });
    return { db, cookies };
  }
  const owner = session(),
    employee = session();
  let companyId = "",
    employeeId = "",
    professionalId = "",
    invitationId = "";
  let acceptanceAttempted = false;
  const teamRoute = () => `/painel/${companyId}/equipe`;
  async function request(client: TestSession, path: string, form?: FormData) {
    const url = new URL(path, base);
    check(
      url.origin === base.origin,
      "Refusing cross-origin demo session transfer.",
    );
    if (form)
      check(
        companyId && url.pathname === teamRoute(),
        "Only the verified synthetic team's page may receive form submissions.",
      );
    const response = await fetch(url, {
      method: form ? "POST" : "GET",
      body: form,
      headers: {
        Accept: "text/html",
        Cookie: [...client.cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        ...(form
          ? {
              Origin: base.origin,
              Referer: new URL(teamRoute(), base).toString(),
            }
          : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        separator = pair.indexOf("=");
      if (separator > 0) {
        const name = pair.slice(0, separator),
          value = pair.slice(separator + 1);
        if (!value || /max-age=0(?:;|$)/i.test(header))
          client.cookies.delete(name);
        else client.cookies.set(name, value);
      }
    }
    return response;
  }
  async function html(client: TestSession, path = teamRoute()) {
    const response = await request(client, path);
    check(response.status === 200, "Expected team page did not load.");
    return response.text();
  }
  async function destination(response: Response) {
    let target = [303, 307, 308].includes(response.status)
      ? response.headers.get("location")
      : null;
    if (response.status === 200) {
      const source = await response.text();
      const redirect = [...source.matchAll(/<meta\b[^>]*>/g)]
        .map((m) => attributes(m[0]))
        .find(
          (m) =>
            m.id === "__next-page-redirect" &&
            m["http-equiv"]?.toLowerCase() === "refresh",
        );
      target =
        redirect?.content?.match(/^\s*[01]\s*;\s*url=(.+)\s*$/i)?.[1] || null;
    }
    check(
      target,
      "Expected an HTTP redirect or explicit Next redirect metadata.",
    );
    const url = new URL(target, base);
    check(url.origin === base.origin, "Unexpected redirect origin.");
    return url;
  }
  async function rows(
    db: SupabaseClient,
    table: string,
    select = "id",
    company = companyId,
  ) {
    const result = await db
      .from(table)
      .select(select, { count: "exact" })
      .eq(table === "companies" ? "id" : "company_id", company)
      .limit(500);
    check(
      !result.error &&
        result.data &&
        result.count !== null &&
        result.count <= 500,
      "Could not safely inspect the complete synthetic data set.",
    );
    return result.data as unknown as Record<string, unknown>[];
  }
  async function member() {
    const result = await owner.db
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", employeeId)
      .maybeSingle();
    check(!result.error, "Could not verify the temporary membership.");
    return result.data;
  }
  async function professional() {
    const result = await owner.db
      .from("professionals")
      .select("id,company_id,name,user_id")
      .eq("company_id", companyId)
      .eq("id", professionalId)
      .single();
    check(
      !result.error && result.data,
      "Could not verify the existing synthetic professional.",
    );
    return result.data;
  }
  try {
    phase = "authenticate synthetic accounts";
    const signed = await Promise.all([
      owner.db.auth.signInWithPassword({ email: ownerEmail, password }),
      employee.db.auth.signInWithPassword({ email: employeeEmail, password }),
    ]);
    check(
      signed.every(
        (result) => !result.error && result.data.user?.email_confirmed_at,
      ),
      "Both existing synthetic accounts must sign in with confirmed email.",
    );
    const ownerUser = signed[0].data.user!,
      employeeUser = signed[1].data.user!;
    employeeId = employeeUser.id;
    check(
      ownerUser.email === ownerEmail &&
        employeeUser.email === employeeEmail &&
        ownerUser.id !== employeeId,
      "Unexpected demo identity.",
    );
    const ownerMemberships = await owner.db
      .from("memberships")
      .select("company_id,role")
      .eq("user_id", ownerUser.id);
    const employeeMemberships = await employee.db
      .from("memberships")
      .select("company_id,role")
      .eq("user_id", employeeId);
    check(
      !ownerMemberships.error &&
        ownerMemberships.data?.length === 1 &&
        ownerMemberships.data[0].role === "OWNER",
      "The logistics demo must have exactly its original owner membership.",
    );
    check(
      !employeeMemberships.error &&
        employeeMemberships.data?.length === 1 &&
        employeeMemberships.data[0].role === "OWNER",
      "The supplier demo must have exactly its original owner membership.",
    );
    companyId = ownerMemberships.data[0].company_id;
    const foreignCompanyId = employeeMemberships.data[0].company_id;
    check(
      companyId !== foreignCompanyId,
      "Synthetic companies must be distinct.",
    );
    const snapshot = await rows(
      owner.db,
      "companies",
      "id,name,niche,is_demo,status,plan_id,trial_ends_at",
    );
    const foreignSnapshot = await rows(
      employee.db,
      "companies",
      "id,name,niche,is_demo,status,plan_id,trial_ends_at",
      foreignCompanyId,
    );
    check(
      snapshot.length === 1 &&
        snapshot[0].is_demo === true &&
        snapshot[0].niche === "logistica",
      "Refusing to mutate a non-demo logistics tenant.",
    );
    check(
      foreignSnapshot.length === 1 &&
        foreignSnapshot[0].is_demo === true &&
        foreignSnapshot[0].niche === "fornecedores",
      "The second identity must own the supplier demo.",
    );
    check(
      snapshot[0].status === "active" ||
        (snapshot[0].status === "trialing" &&
          Date.parse(String(snapshot[0].trial_ends_at)) > Date.now()),
      "The synthetic company must already have commercial access.",
    );
    check(
      !(await member()),
      "Refusing to alter an existing foreign membership.",
    );
    const professionalsBefore = await rows(
      owner.db,
      "professionals",
      "id,company_id,name,user_id",
    );
    const free = professionalsBefore.find((person) => person.user_id === null);
    check(free, "No existing unlinked synthetic professional is available.");
    professionalId = String(free.id);
    const appointmentsBefore = await rows(
      owner.db,
      "appointments",
      "id,customer_id,professional_id,starts_at,ends_at,status",
    );
    const customersBefore = await rows(owner.db, "customers", "id,name,phone");
    const shiftsBefore = await rows(
      owner.db,
      "availability",
      "id,professional_id,weekday,start_minute,end_minute",
    );
    const invitationsBefore = await owner.db
      .from("invitations")
      .select("id,expires_at,accepted_at")
      .eq("company_id", companyId)
      .eq("email", employeeEmail);
    check(
      !invitationsBefore.error &&
        !invitationsBefore.data?.some(
          (i) => !i.accepted_at && Date.parse(i.expires_at) > Date.now(),
        ),
      "Refusing to interfere with a pending invitation for this demo identity.",
    );
    const previousInvitationIds = new Set(
      (invitationsBefore.data || []).map((i) => i.id),
    );
    pass(
      "two synthetic tenants verified; original data and available professional recorded",
    );

    phase = "owner directory and invitation form";
    let source = await html(owner);
    check(
      source.includes(ownerEmail) &&
        source.includes("Vincular contas à agenda"),
      "Owner email directory and assignment interface were not rendered.",
    );
    const invite = actionForm(source, (inputs) =>
      inputs.some((i) => i.name === "email"),
    );
    invite.set("email", employeeEmail);
    invite.set("role", "EMPLOYEE");
    const invited = await destination(
      await request(owner, teamRoute(), invite),
    );
    const token = invited.searchParams.get("convite");
    check(
      invited.pathname === teamRoute() && token && /^[a-f0-9]{64}$/.test(token),
      "Invitation was not confirmed by the server.",
    );
    const invitationsAfter = await owner.db
      .from("invitations")
      .select("id")
      .eq("company_id", companyId)
      .eq("email", employeeEmail);
    check(
      !invitationsAfter.error,
      "Could not inspect the created demo invitation.",
    );
    const createdInvitations = (invitationsAfter.data || []).filter(
      (i) => !previousInvitationIds.has(i.id),
    );
    check(
      createdInvitations.length === 1,
      "Expected exactly one invitation created by this run.",
    );
    invitationId = createdInvitations[0].id;
    pass(
      "owner creates a genuine invitation through the Server Action without sending email",
    );

    phase = "accept invitation with existing confirmed demo identity";
    acceptanceAttempted = true;
    const accepted = await employee.db.rpc("accept_invitation", { token });
    check(
      !accepted.error &&
        accepted.data === companyId &&
        (await member())?.role === "EMPLOYEE",
      "Invitation acceptance did not create the scoped employee membership.",
    );
    assert.deepEqual(
      await rows(
        employee.db,
        "companies",
        "id,name,niche,is_demo,status,plan_id,trial_ends_at",
        foreignCompanyId,
      ),
      foreignSnapshot,
    );
    pass(
      "existing supplier demo accepts employee access while its own company remains unchanged",
    );

    phase = "unlinked employee isolation";
    for (const table of [
      "professionals",
      "appointments",
      "customers",
      "availability",
    ])
      check(
        (await rows(employee.db, table)).length === 0,
        "An unlinked employee could read logistics operational data.",
      );
    check(
      (await employee.db.rpc("company_team_directory", { c: companyId })).error,
      "Employee could enumerate the owner-only email directory.",
    );
    const employeePage = await html(employee);
    check(
      employeePage.includes("Sua conta") && !employeePage.includes(ownerEmail),
      "Employee team page leaked the owner email directory.",
    );
    pass(
      "unlinked employee sees no assigned operational data or owner-only directory",
    );

    phase = "bind professional through owner Server Action";
    source = await html(owner);
    const assignment = actionForm(source, (inputs) =>
      inputs.some(
        (i) => i.name === "professional_id" && i.value === professionalId,
      ),
    );
    assignment.set("member_id", employeeId);
    const assigned = await destination(
      await request(owner, teamRoute(), assignment),
    );
    check(
      assigned.searchParams.get("salvo") === "vinculo" &&
        (await professional()).user_id === employeeId,
      "Professional linkage was not persisted by the server.",
    );
    const visibleProfessionals = await rows(
      employee.db,
      "professionals",
      "id,name,user_id",
    );
    check(
      visibleProfessionals.length === 1 &&
        visibleProfessionals[0].id === professionalId,
      "Employee professional visibility is not scoped to the assignment.",
    );
    const visibleAppointments = await rows(
      employee.db,
      "appointments",
      "id,customer_id,professional_id",
    );
    check(
      visibleAppointments.every(
        (item) => item.professional_id === professionalId,
      ),
      "Employee read an appointment assigned to another professional.",
    );
    const expectedAppointments = appointmentsBefore.filter(
      (item) => item.professional_id === professionalId,
    );
    assert.deepEqual(
      visibleAppointments.map((item) => item.id).sort(),
      expectedAppointments.map((item) => item.id).sort(),
    );
    const visibleCustomers = await rows(employee.db, "customers", "id");
    const expectedCustomers = new Set(
      expectedAppointments.map((item) => item.customer_id),
    );
    assert.deepEqual(
      visibleCustomers.map((item) => item.id).sort(),
      [...expectedCustomers].sort(),
    );
    const visibleShifts = await rows(
      employee.db,
      "availability",
      "id,professional_id",
    );
    check(
      visibleShifts.length ===
        shiftsBefore.filter((item) => item.professional_id === professionalId)
          .length &&
        visibleShifts.every((item) => item.professional_id === professionalId),
      "Employee availability is not scoped to the assignment.",
    );
    const agenda = await html(employee, `/painel/${companyId}/agenda`);
    check(
      agenda.includes(String(free.name)) && agenda.includes("Data da agenda"),
      "Employee's actual agenda did not render.",
    );
    pass(
      "real linkage unlocks only the professional agenda, availability and related customers",
    );

    phase = "owner authorization and confirmation guards";
    const forbidden = cloneForm(assignment);
    forbidden.set("expected_member_id", employeeId);
    forbidden.set("member_id", "");
    forbidden.set("confirm_action", "yes");
    const refused = await destination(
      await request(employee, teamRoute(), forbidden),
    );
    check(
      refused.searchParams.get("erro") === "permissao" &&
        (await professional()).user_id === employeeId,
      "Employee was able to reassign its own access.",
    );
    const linkedForm = actionForm(await html(owner), (inputs) =>
      inputs.some(
        (i) => i.name === "professional_id" && i.value === professionalId,
      ),
    );
    linkedForm.set("member_id", "");
    const missingLinkConfirmation = await destination(
      await request(owner, teamRoute(), linkedForm),
    );
    check(
      missingLinkConfirmation.searchParams.get("erro") === "confirmacao" &&
        (await professional()).user_id === employeeId,
      "Unlinking did not require server-visible confirmation.",
    );
    pass(
      "employee mutation denied and owner unlink without confirmation rejected",
    );

    phase = "revoke access through confirmed Server Action";
    const removal = actionForm(
      await html(owner),
      (inputs, form) =>
        form.includes("team-revoke-form") &&
        inputs.some((i) => i.name === "member_id" && i.value === employeeId),
    );
    const missingRevokeConfirmation = await destination(
      await request(owner, teamRoute(), cloneForm(removal)),
    );
    check(
      missingRevokeConfirmation.searchParams.get("erro") === "confirmacao" &&
        (await member())?.role === "EMPLOYEE",
      "Access revocation did not require confirmation.",
    );
    removal.set("confirm_action", "yes");
    const revoked = await destination(
      await request(owner, teamRoute(), removal),
    );
    check(
      revoked.searchParams.get("salvo") === "revogado" &&
        !(await member()) &&
        (await professional()).user_id === null,
      "Confirmed access revocation did not restore the unlinked professional.",
    );
    pass(
      "revocation requires confirmation and removes only the temporary access",
    );

    phase = "same authenticated session loses tenant data";
    const stillAuthenticated = await employee.db.auth.getUser();
    check(
      !stillAuthenticated.error &&
        stillAuthenticated.data.user?.id === employeeId,
      "Revoked identity should remain authenticated to its own account.",
    );
    for (const table of [
      "companies",
      "memberships",
      "professionals",
      "appointments",
      "customers",
      "availability",
    ])
      check(
        (
          await rows(
            employee.db,
            table,
            table === "memberships" ? "user_id" : "id",
          )
        ).length === 0,
        "The authenticated revoked identity still reads the logistics tenant.",
      );
    const deniedPage = await destination(
      await request(employee, `/painel/${companyId}/agenda`),
    );
    check(
      deniedPage.pathname === "/painel" &&
        deniedPage.searchParams.get("erro") === "acesso",
      "Revoked employee still accessed the tenant agenda page.",
    );
    assert.deepEqual(
      await rows(
        employee.db,
        "companies",
        "id,name,niche,is_demo,status,plan_id,trial_ends_at",
        foreignCompanyId,
      ),
      foreignSnapshot,
    );
    pass(
      "still-authenticated identity immediately loses revoked tenant visibility and keeps its own company",
    );

    phase = "preserve original business data";
    const sorted = (items: Record<string, unknown>[]) =>
      items.slice().sort((x, y) => String(x.id).localeCompare(String(y.id)));
    assert.deepEqual(
      sorted(
        await rows(owner.db, "professionals", "id,company_id,name,user_id"),
      ),
      sorted(professionalsBefore),
    );
    assert.deepEqual(
      sorted(
        await rows(
          owner.db,
          "appointments",
          "id,customer_id,professional_id,starts_at,ends_at,status",
        ),
      ),
      sorted(appointmentsBefore),
    );
    assert.deepEqual(
      sorted(await rows(owner.db, "customers", "id,name,phone")),
      sorted(customersBefore),
    );
    assert.deepEqual(
      sorted(
        await rows(
          owner.db,
          "availability",
          "id,professional_id,weekday,start_minute,end_minute",
        ),
      ),
      sorted(shiftsBefore),
    );
    assert.deepEqual(
      await rows(
        owner.db,
        "companies",
        "id,name,niche,is_demo,status,plan_id,trial_ends_at",
      ),
      snapshot,
    );
    pass(
      "professional, agenda, customers, availability and commercial status remain unchanged",
    );
  } finally {
    try {
      if (acceptanceAttempted && invitationId && companyId && employeeId) {
        const invitation = await owner.db
          .from("invitations")
          .select("accepted_at")
          .eq("company_id", companyId)
          .eq("id", invitationId)
          .maybeSingle();
        check(
          !invitation.error,
          "Could not inspect this run's invitation during cleanup.",
        );
        const current = await member();
        if (current) {
          check(
            invitation.data?.accepted_at && current.role === "EMPLOYEE",
            "Unexpected membership state; cleanup refuses to remove access it cannot attribute to this test.",
          );
          const cleanup = await owner.db.rpc("revoke_company_member", {
            c: companyId,
            member: employeeId,
            confirmed: true,
          });
          check(
            !cleanup.error,
            "Could not clean up the temporary synthetic membership.",
          );
        }
      }
    } finally {
      await Promise.allSettled([
        owner.db.auth.signOut({ scope: "local" }),
        employee.db.auth.signOut({ scope: "local" }),
      ]);
    }
  }
  console.log(
    `${checks} live team access groups passed; only the invitation audit record is retained`,
  );
}
main().catch((error) => {
  console.error(
    `FAIL ${phase}: ${error instanceof TestFailure ? error.message : "Unexpected integration failure (details withheld to avoid credential logging)."}`,
  );
  process.exitCode = 1;
});
