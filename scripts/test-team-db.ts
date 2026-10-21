import { installLegacyTrialFixtures } from "./legacy-trial-fixture";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { storageFixture } from "./storage-fixture";

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(
  `create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
);
await db.exec(storageFixture);
for (const name of (await readdir("supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
await installLegacyTrialFixtures(db);
const exists = await db.query<{ existing: string | null }>(
  "select to_regprocedure('public.assign_professional_member(uuid,uuid,uuid,uuid,boolean)')::text as existing",
);
if (!exists.rows[0].existing)
  await db.exec(
    await readFile("supabase/drafts/professional_membership.sql", "utf8"),
  );
const a = randomUUID(),
  b = randomUUID(),
  employee = randomUUID(),
  manager = randomUUID(),
  replacement = randomUUID();
await db.query(
  "insert into auth.users(id,email,email_confirmed_at) values($1,'owner-a@example.invalid',now()),($2,'owner-b@example.invalid',now()),($3,'employee@example.invalid',now()),($4,'manager@example.invalid',now()),($5,'replacement@example.invalid',now())",
  [a, b, employee, manager, replacement],
);
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user || "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
async function scalar(sql: string, args: unknown[] = []) {
  const result = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(result.rows[0])[0];
}
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS team: ${name}`);
}
await as(a);
const ca = String(
  await scalar("select create_company('Empresa A teste','salao')"),
);
await as(b);
const cb = String(
  await scalar("select create_company('Empresa B teste','salao')"),
);
await db.exec("reset role");
await db.query("update companies set plan_id='profissional' where id=$1", [ca]);
await db.query(
  "insert into memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER'),($1,$4,'EMPLOYEE')",
  [ca, employee, manager, replacement],
);
await as(a);
const pa = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional A teste') returning id",
    [ca],
  ),
);
const pa2 = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional A2 teste') returning id",
    [ca],
  ),
);
const customer = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'Cliente atribuído teste') returning id",
    [ca],
  ),
);
const unrelated = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'Cliente não atribuído teste') returning id",
    [ca],
  ),
);
const service = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Serviço teste',30,1000) returning id",
    [ca],
  ),
);
const appointment = String(
  await scalar(
    "select book_appointment($1,$2,$3,$4,'2099-01-05T10:00:00-03:00')",
    [ca, customer, service, pa],
  ),
);
await db.query(
  "select book_appointment($1,$2,$3,$4,'2099-01-05T10:00:00-03:00')",
  [ca, unrelated, service, pa2],
);
await as(b);
const pb = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional B teste') returning id",
    [cb],
  ),
);
const assign = (
  company: string,
  professional: string,
  member: string | null,
  expected: string | null = null,
  confirmed = false,
) =>
  db.query("select assign_professional_member($1,$2,$3,$4,$5)", [
    company,
    professional,
    member,
    expected,
    confirmed,
  ]);
const revoke = (company: string, member: string, confirmed = false) =>
  db.query("select revoke_company_member($1,$2,$3)", [
    company,
    member,
    confirmed,
  ]);
await as(a);
await check(
  "owner directory includes emails only from its own company",
  async () => {
    const rows = (
      await db.query<{ email: string }>(
        "select * from company_team_directory($1)",
        [ca],
      )
    ).rows;
    assert.equal(rows.length, 4);
    assert.ok(rows.some((row) => row.email === "employee@example.invalid"));
    assert.ok(!rows.some((row) => row.email === "owner-b@example.invalid"));
    await assert.rejects(
      () => db.query("select * from company_team_directory($1)", [cb]),
      /not authorized/,
    );
  },
);
await check(
  "cross-company professional and account assignment rejected",
  async () => {
    await assert.rejects(
      () => assign(ca, pb, employee),
      /professional not found/,
    );
    await assert.rejects(() => assign(cb, pb, b), /not authorized/);
    await assert.rejects(() => assign(ca, pa, b), /member not found/);
  },
);
await check("owner assignment preserves counts and plan", async () => {
  await assign(ca, pa, employee);
  assert.equal(
    Number(
      await scalar("select count(*) from professionals where company_id=$1", [
        ca,
      ]),
    ),
    2,
  );
  assert.equal(
    await scalar("select plan_id from companies where id=$1", [ca]),
    "profissional",
  );
  await assert.rejects(
    () => assign(ca, pa2, employee),
    /member already assigned/,
  );
});
await as(employee);
await check(
  "assigned employee reads only the linked agenda and related customer",
  async () => {
    assert.equal(Number(await scalar("select count(*) from appointments")), 1);
    assert.equal(await scalar("select id from appointments"), appointment);
    assert.equal(Number(await scalar("select count(*) from customers")), 1);
    assert.equal(await scalar("select id from customers"), customer);
    assert.equal(Number(await scalar("select count(*) from professionals")), 1);
    assert.equal(Number(await scalar("select count(*) from availability")), 5);
  },
);
await check(
  "employee cannot enumerate emails, reassign or revoke access",
  async () => {
    await assert.rejects(
      () => db.query("select * from company_team_directory($1)", [ca]),
      /not authorized/,
    );
    await assert.rejects(
      () => assign(ca, pa, replacement, employee, true),
      /not authorized/,
    );
    await assert.rejects(() => revoke(ca, manager, true), /not authorized/);
  },
);
await as(manager);
await check(
  "manager cannot alter access through RPC or direct Data API",
  async () => {
    await assert.rejects(
      () => db.query("select * from company_team_directory($1)", [ca]),
      /not authorized/,
    );
    await assert.rejects(
      () => assign(ca, pa, replacement, employee, true),
      /not authorized/,
    );
    await assert.rejects(() => revoke(ca, employee, true), /not authorized/);
    await assert.rejects(
      () =>
        db.query("update professionals set user_id=$1 where id=$2", [
          manager,
          pa,
        ]),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into professionals(company_id,name,user_id) values($1,'Tentativa', $2)",
          [ca, manager],
        ),
      /permission denied/,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where company_id=$1", [
          ca,
        ]),
      ),
      2,
    );
  },
);
await as(a);
await check(
  "remap and unlink require confirmation and reject stale submissions",
  async () => {
    await assert.rejects(
      () => assign(ca, pa, replacement, employee),
      /confirmation required/,
    );
    await assert.rejects(
      () => assign(ca, pa, null, employee),
      /confirmation required/,
    );
    await assign(ca, pa, replacement, employee, true);
    await assert.rejects(
      () => assign(ca, pa, employee, employee, true),
      /assignment version conflict/,
    );
  },
);
await as(employee);
await check(
  "remapping immediately removes old employee visibility",
  async () => {
    assert.equal(Number(await scalar("select count(*) from appointments")), 0);
    assert.equal(Number(await scalar("select count(*) from customers")), 0);
  },
);
await as(a);
await assign(ca, pa, null, replacement, true);
await check("unlink preserves professional and all appointments", async () => {
  assert.equal(
    await scalar("select user_id from professionals where id=$1", [pa]),
    null,
  );
  assert.equal(
    Number(
      await scalar(
        "select count(*) from appointments where professional_id=$1",
        [pa],
      ),
    ),
    1,
  );
  await assign(ca, pa, employee);
});
await check(
  "direct inserts cannot assign access and ordinary creation keeps plan limits",
  async () => {
    await assert.rejects(
      () =>
        db.query(
          "insert into professionals(company_id,name,user_id) values($1,'Tentativa owner',$2)",
          [ca, replacement],
        ),
      /permission denied/,
    );
    await db.query(
      "insert into professionals(company_id,name) values($1,'Terceiro profissional teste')",
      [ca],
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into professionals(company_id,name) values($1,'Além do plano teste')",
          [ca],
        ),
      /professional limit/,
    );
  },
);
await check(
  "revocation cannot target owner or foreign members and needs confirmation",
  async () => {
    await assert.rejects(() => revoke(ca, employee), /confirmation required/);
    await assert.rejects(() => revoke(ca, a, true), /cannot revoke owner/);
    await assert.rejects(() => revoke(cb, b, true), /not authorized/);
    await assert.rejects(() => revoke(ca, b, true), /member not found/);
  },
);
// Legacy pending invitation fixture: new issuance now rejects existing members,
// but revocation must still permanently cancel older outstanding invitations.
const invitation = (randomUUID() + randomUUID()).replaceAll("-", "");
await db.exec("reset role");
const legacyInvitationId = String(
  await scalar(
    "insert into invitations(company_id,email,role,token_hash) values($1,'employee@example.invalid','EMPLOYEE',encode(sha256(convert_to($2,'UTF8')),'hex')) returning id",
    [ca, invitation],
  ),
);
await as(a);
await revoke(ca, employee, true);
await check(
  "revocation preserves schedule and expires outstanding invitations",
  async () => {
    assert.equal(
      await scalar("select user_id from professionals where id=$1", [pa]),
      null,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from appointments where professional_id=$1",
          [pa],
        ),
      ),
      1,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from availability where professional_id=$1",
          [pa],
        ),
      ),
      5,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from invitations where company_id=$1 and email='employee@example.invalid' and expires_at>now() and accepted_at is null",
          [ca],
        ),
      ),
      0,
    );
  },
);
await as(employee);
await check(
  "still-valid user identity loses tenant visibility immediately after revocation",
  async () => {
    assert.equal(await scalar("select auth.uid()::text"), employee);
    for (const table of [
      "companies",
      "memberships",
      "professionals",
      "appointments",
      "customers",
      "availability",
    ])
      assert.equal(
        Number(
          await scalar(
            `select count(*) from public.${table} where ${table === "companies" ? "id" : "company_id"}=$1`,
            [ca],
          ),
        ),
        0,
      );
    await assert.rejects(
      () => db.query("select accept_invitation($1)", [invitation]),
      /invalid invitation/,
    );
  },
);
await as(a);
await revoke(ca, manager, true);
await as(manager);
await check(
  "revoked manager loses all company appointment access",
  async () => {
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where company_id=$1", [
          ca,
        ]),
      ),
      0,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into customers(company_id,name) values($1,'Tentativa revogada')",
          [ca],
        ),
      /row-level security/,
    );
  },
);
for (const status of ["past_due", "suspended", "trialing"]) {
  await db.exec("reset role");
  await db.query(
    "update companies set status=$2,trial_ends_at=now()-interval '1 day' where id=$1",
    [ca, status],
  );
  await db.query(
    "insert into memberships(company_id,user_id,role) values($1,$2,'EMPLOYEE') on conflict do nothing",
    [ca, replacement],
  );
  await db.query("update professionals set user_id=$1 where id=$2", [
    replacement,
    pa,
  ]);
  await as(a);
  await check(
    `owner can revoke access after ${status === "trialing" ? "trial expiration" : status} without changing data or ownership`,
    async () => {
      await assert.rejects(
        () => assign(ca, pa, replacement),
        /subscription blocked/,
      );
      await assert.rejects(() => revoke(ca, a, true), /cannot revoke owner/);
      await assert.rejects(
        () => revoke(ca, replacement),
        /confirmation required/,
      );
      await revoke(ca, replacement, true);
      assert.equal(
        await scalar("select user_id from professionals where id=$1", [pa]),
        null,
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from memberships where company_id=$1 and user_id=$2",
            [ca, replacement],
          ),
        ),
        0,
      );
      assert.equal(
        await scalar(
          "select role from memberships where company_id=$1 and user_id=$2",
          [ca, a],
        ),
        "OWNER",
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from appointments where company_id=$1",
            [ca],
          ),
        ),
        2,
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from professionals where company_id=$1",
            [ca],
          ),
        ),
        3,
      );
      assert.equal(
        Number(
          await scalar("select count(*) from customers where company_id=$1", [
            ca,
          ]),
        ),
        2,
      );
    },
  );
}
await as(null);
await check("anonymous RPC invocation denied", async () => {
  await assert.rejects(
    () => db.query("select * from company_team_directory($1)", [ca]),
    /permission denied/,
  );
  await assert.rejects(() => assign(ca, pa, replacement), /permission denied/);
  await assert.rejects(
    () => revoke(ca, replacement, true),
    /permission denied/,
  );
});
await db.exec("reset role");
await db.query(
  "update companies set status='trialing',trial_ends_at=now()+interval '7 days' where id=$1",
  [ca],
);
await db.query(
  "insert into memberships(company_id,user_id,role) values($1,$2,'MANAGER')",
  [ca, manager],
);
const invited = randomUUID(),
  unconfirmed = randomUUID(),
  quotaOwner = randomUUID();
await db.query(
  "insert into auth.users values($1,'invited@example.invalid',now()),($2,'unconfirmed@example.invalid',null),($3,'quota-owner@example.invalid',now())",
  [invited, unconfirmed, quotaOwner],
);
type Issue = {
  id: string;
  issue_id: string;
  token: string;
  email: string;
  role: string;
  company_name: string;
  expires_at: string;
};
const create = (
  company: string,
  email: string | null,
  role: string | null = "EMPLOYEE",
) =>
  scalar("select create_team_invitation($1,$2,$3)", [
    company,
    email,
    role,
  ]) as Promise<Issue>;
const resend = (company: string, id: string | null) =>
  scalar("select resend_team_invitation($1,$2)", [
    company,
    id,
  ]) as Promise<Issue>;
const cancel = (company: string, id: string | null, confirmed = false) =>
  db.query("select cancel_team_invitation($1,$2,$3)", [company, id, confirmed]);
const acceptInvitation = (token: string | null) =>
  scalar("select accept_invitation($1)", [token]);
async function ageIssue(id: string) {
  await db.exec("reset role");
  await db.query(
    "update invitations set last_issued_at=now()-interval '61 seconds' where id=$1",
    [id],
  );
  await as(a);
}
await as(a);
let issued: Issue;
await check(
  "issuance returns authorized context once and stores no plaintext token",
  async () => {
    issued = await create(ca, "  Invited@Example.invalid  ");
    assert.equal(issued.email, "invited@example.invalid");
    assert.equal(issued.role, "EMPLOYEE");
    assert.equal(issued.company_name, "Empresa A teste");
    assert.match(issued.token, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(issued.expires_at) > Date.now() + 47 * 3600000);
    await assert.rejects(
      () => db.query("select token_hash from invitations"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from private.team_invitation_issues"),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(
      await scalar(
        "select token_hash=encode(sha256(convert_to($2,'UTF8')),'hex') from invitations where id=$1",
        [issued.id, issued.token],
      ),
      true,
    );
    assert.equal(
      Number(
        await scalar(
          "select count(*) from private.team_invitation_issues where invitation_id=$1",
          [issued.id],
        ),
      ),
      1,
    );
    await as(a);
  },
);
await check(
  "issuance rejects invalid fields, duplicate pending invite and existing members",
  async () => {
    await assert.rejects(
      () => create(ca, "invited@example.invalid"),
      /pending invitation exists/,
    );
    await assert.rejects(
      () => create(ca, "owner-a@example.invalid"),
      /already a member/,
    );
    for (const email of [
      null,
      "bad-address",
      "a b@example.invalid",
      "x".repeat(255) + "@example.invalid",
    ])
      await assert.rejects(() => create(ca, email), /invalid invitation/);
    for (const role of [null, "OWNER", "SUPER_ADMIN"])
      await assert.rejects(
        () => create(ca, "other@example.invalid", role),
        /invalid invitation/,
      );
    await assert.rejects(() => resend(ca, null), /invitation unavailable/);
  },
);
await check(
  "owner-only issue/resend/cancel and safe invitation SELECT are tenant scoped",
  async () => {
    for (const user of [b, employee, manager, null]) {
      await as(user);
      await assert.rejects(
        () => create(ca, "unauthorized@example.invalid"),
        /not authorized|permission denied/,
      );
      await assert.rejects(
        () => resend(ca, issued.id),
        /not authorized|permission denied/,
      );
      await assert.rejects(
        () => cancel(ca, issued.id, true),
        /not authorized|permission denied/,
      );
      if (user)
        assert.equal(
          Number(
            await scalar(
              "select count(*) from invitations where company_id=$1",
              [ca],
            ),
          ),
          0,
        );
    }
    await as(b);
    await assert.rejects(() => resend(cb, issued.id), /invitation unavailable/);
    await assert.rejects(
      () => cancel(cb, issued.id, true),
      /invitation unavailable/,
    );
    await as(a);
  },
);
await check(
  "resend obeys cooldown, preserves role/id and permanently invalidates old token",
  async () => {
    await assert.rejects(() => resend(ca, issued.id), /invitation cooldown/);
    await ageIssue(issued.id);
    const renewed = await resend(ca, issued.id);
    assert.equal(renewed.id, issued.id);
    assert.equal(renewed.email, issued.email);
    assert.equal(renewed.role, issued.role);
    assert.notEqual(renewed.token, issued.token);
    assert.notEqual(renewed.issue_id, issued.issue_id);
    await as(invited);
    await assert.rejects(
      () => acceptInvitation(issued.token),
      /invalid invitation/,
    );
    assert.equal(await acceptInvitation(renewed.token), ca);
    await assert.rejects(
      () => acceptInvitation(renewed.token),
      /invalid invitation/,
    );
    await as(a);
    await assert.rejects(
      () => resend(ca, renewed.id),
      /invitation unavailable/,
    );
    await assert.rejects(
      () => cancel(ca, renewed.id, true),
      /invitation unavailable/,
    );
    issued = renewed;
  },
);
await check(
  "email confirmation and exact invited email are required independently of the UI",
  async () => {
    const issue = await create(ca, "unconfirmed@example.invalid");
    await as(unconfirmed);
    await assert.rejects(
      () => acceptInvitation(issue.token),
      /invalid invitation/,
    );
    await assert.rejects(() => acceptInvitation(null), /not authorized/);
    await as(b);
    await assert.rejects(
      () => acceptInvitation(issue.token),
      /invalid invitation/,
    );
    await as(a);
    await assert.rejects(() => cancel(ca, issue.id), /confirmation required/);
    await cancel(ca, issue.id, true);
    await cancel(ca, issue.id, true);
    await assert.rejects(() => resend(ca, issue.id), /invitation unavailable/);
    await assert.rejects(
      () => create(ca, "unconfirmed@example.invalid"),
      /invitation cooldown/,
    );
    await db.exec("reset role");
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [unconfirmed],
    );
    await as(unconfirmed);
    await assert.rejects(
      () => acceptInvitation(issue.token),
      /invalid invitation/,
    );
    await as(a);
  },
);
await check(
  "expired invitations reject acceptance and may be renewed without changing permission",
  async () => {
    await ageIssue(
      String(
        await scalar(
          "select id from invitations where company_id=$1 and email='unconfirmed@example.invalid' order by created_at desc limit 1",
          [ca],
        ),
      ),
    );
    const issue = await create(ca, "unconfirmed@example.invalid", "MANAGER");
    await db.exec("reset role");
    await db.query(
      "update invitations set expires_at=now()-interval '1 second',last_issued_at=now()-interval '61 seconds' where id=$1",
      [issue.id],
    );
    await as(unconfirmed);
    await assert.rejects(
      () => acceptInvitation(issue.token),
      /invalid invitation/,
    );
    await as(a);
    const renewal = await resend(ca, issue.id);
    assert.equal(renewal.role, "MANAGER");
    assert.equal(renewal.id, issue.id);
    await as(unconfirmed);
    assert.equal(await acceptInvitation(renewal.token), ca);
    await as(a);
  },
);
await check(
  "capacity is checked at issuance and again at acceptance; pending links reserve no seats",
  async () => {
    await assert.rejects(
      () => create(ca, "capacity@example.invalid"),
      /member limit/,
    );
    await revoke(ca, unconfirmed, true);
    await ageIssue(
      String(
        await scalar(
          "select id from invitations where company_id=$1 and email='unconfirmed@example.invalid' order by created_at desc limit 1",
          [ca],
        ),
      ),
    );
    const issue = await create(ca, "unconfirmed@example.invalid");
    await db.exec("reset role");
    await db.query("insert into memberships values($1,$2,'EMPLOYEE')", [
      ca,
      employee,
    ]);
    await as(unconfirmed);
    await assert.rejects(() => acceptInvitation(issue.token), /member limit/);
    await as(a);
    assert.equal(
      await scalar("select accepted_at is null from invitations where id=$1", [
        issue.id,
      ]),
      true,
    );
    await revoke(ca, employee, true);
    await cancel(ca, issue.id, true);
  },
);
await check(
  "revocation permanently cancels legacy pending invitations; resend cannot resurrect access",
  async () => {
    assert.equal(
      await scalar(
        "select canceled_at is not null from invitations where id=$1",
        [legacyInvitationId],
      ),
      true,
    );
    await assert.rejects(
      () => resend(ca, legacyInvitationId),
      /invitation unavailable/,
    );
  },
);
for (const status of ["past_due", "suspended", "trialing"]) {
  await check(
    `cancel stays available when ${status}; issue/resend/accept stay blocked`,
    async () => {
      const issue = await create(ca, `${status}@example.invalid`);
      await db.exec("reset role");
      const actor = randomUUID();
      await db.query("insert into auth.users values($1,$2,now())", [
        actor,
        issue.email,
      ]);
      await db.query(
        "update companies set status=$2,trial_ends_at=now()-interval '1 day' where id=$1",
        [ca, status],
      );
      await as(a);
      await assert.rejects(
        () => create(ca, "blocked@example.invalid"),
        /subscription blocked/,
      );
      await assert.rejects(() => resend(ca, issue.id), /subscription blocked/);
      await as(actor);
      await assert.rejects(
        () => acceptInvitation(issue.token),
        /subscription blocked/,
      );
      await as(a);
      await cancel(ca, issue.id, true);
      assert.equal(
        await scalar(
          "select canceled_at is not null from invitations where id=$1",
          [issue.id],
        ),
        true,
      );
      await db.exec("reset role");
      await db.query(
        "update companies set status='trialing',trial_ends_at=now()+interval '7 days' where id=$1",
        [ca],
      );
      await as(a);
    },
  );
}
await as(quotaOwner);
const quotaCompany = String(
  await scalar("select create_company('Cota de convites teste','salao')"),
);
await check(
  "legacy wrapper and resend share persisted rolling quota, including canceled issues",
  async () => {
    const first = await create(quotaCompany, "quota-first@example.invalid");
    await db.exec("reset role");
    await db.query(
      "update invitations set last_issued_at=now()-interval '61 seconds' where id=$1",
      [first.id],
    );
    await as(quotaOwner);
    const renewed = await resend(quotaCompany, first.id);
    await cancel(quotaCompany, renewed.id, true);
    for (let i = 2; i < 24; i++)
      await scalar("select invite_member($1,$2,'EMPLOYEE')", [
        quotaCompany,
        `quota-${i}@example.invalid`,
      ]);
    // PGlite serializes one connection; this checks the 24->25 boundary, while
    // multi-session contention requires the separately authorized live suite.
    const outcomes = await Promise.allSettled([
      create(quotaCompany, "quota-final-a@example.invalid"),
      create(quotaCompany, "quota-final-b@example.invalid"),
    ]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
    await assert.rejects(
      () =>
        scalar(
          "select invite_member($1,'over-quota@example.invalid','EMPLOYEE')",
          [quotaCompany],
        ),
      /daily invitation limit/,
    );
    await db.exec("reset role");
    assert.equal(
      Number(
        await scalar(
          "select count(*) from private.team_invitation_issues where company_id=$1",
          [quotaCompany],
        ),
      ),
      25,
    );
    await db.query(
      "update private.team_invitation_issues set issued_at=now()-interval '25 hours' where company_id=$1",
      [quotaCompany],
    );
    await as(quotaOwner);
    assert.match(
      (await create(quotaCompany, "next-day@example.invalid")).token,
      /^[a-f0-9]{64}$/,
    );
  },
);
await check(
  "invitation write paths consistently lock company before invite; no client updates/grants",
  async () => {
    await db.exec("reset role");
    const acceptSql = String(
      await scalar(
        "select pg_get_functiondef('private.accept_invitation(text)'::regprocedure)",
      ),
    );
    assert.ok(
      acceptSql.indexOf("from public.companies") <
        acceptSql.indexOf("select * into inv"),
    );
    assert.match(
      acceptSql,
      /canceled_at is null and expires_at > now\(\) for update/,
    );
    await as(quotaOwner);
    await assert.rejects(
      () => db.query("update invitations set role='OWNER'"),
      /permission denied/,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into invitations(company_id,email,role,token_hash) values($1,'bypass@example.invalid','EMPLOYEE','hash')",
          [quotaCompany],
        ),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("delete from invitations"),
      /permission denied/,
    );
  },
);
await db.close();
console.log(`${checks} team access / RLS checks passed`);
