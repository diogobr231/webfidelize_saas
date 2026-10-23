import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { storageFixture } from "./storage-fixture";
import { installLegacyTrialFixtures } from "./legacy-trial-fixture";

// Disposable PostgreSQL, not a concurrent-connection test or a production probe.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await installLegacyTrialFixtures(db);
async function scalar(sql: string, args: unknown[] = []) {
  return Object.values(
    (await db.query<Record<string, unknown>>(sql, args)).rows[0],
  )[0];
}
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    user ?? "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
async function denied(sql: string, args: unknown[], pattern: RegExp) {
  await assert.rejects(() => db.query(sql, args), pattern);
}
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS classes: ${name}`);
}
const owner = randomUUID(),
  other = randomUUID(),
  employee = randomUUID(),
  manager = randomUUID(),
  stranger = randomUUID(),
  admin = randomUUID();
for (const id of [owner, other, employee, manager, stranger, admin])
  await db.query("insert into auth.users values($1,$2,now())", [
    id,
    `${id}@example.invalid`,
  ]);
await as(owner);
const company = String(
  await scalar("select create_company('Classes A QA','academia')"),
);
await as(other);
const foreign = String(
  await scalar("select create_company('Classes B QA','salao')"),
);
await db.exec("reset role");
await db.query(
  "update companies set plan_id='profissional',booking_enabled=true,booking_slug='classes-qa',is_demo=true where id=$1",
  [company],
);
await db.query(
  "insert into memberships values($1,$2,'EMPLOYEE'),($1,$3,'MANAGER'),($1,$4,'EMPLOYEE')",
  [company, employee, manager, stranger],
);
await db.query("insert into private.platform_admins values($1)", [admin]);
const gateway = "disposable-class-booking-secret-only";
await db.query(
  "insert into private.booking_gateway(secret_hash) values(encode(sha256(convert_to($1,'UTF8')),'hex'))",
  [gateway],
);
await as(owner);
const service = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Grupo QA',60,2500) returning id",
    [company],
  ),
);
const professional = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional QA') returning id",
    [company],
  ),
);
await scalar("select assign_professional_member($1,$2,$3,null,false)", [
  company,
  professional,
  employee,
]);
const customers: string[] = [];
for (let i = 0; i < 5; i++)
  customers.push(
    String(
      await scalar(
        "insert into customers(company_id,name,phone) values($1,$2,$3) returning id",
        [company, `Cliente QA ${i}`, `1199999000${i}`],
      ),
    ),
  );
await as(other);
const foreignService = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Estrangeiro QA',60,5000) returning id",
    [foreign],
  ),
);
const foreignProfessional = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Outro profissional QA') returning id",
    [foreign],
  ),
);
const foreignCustomer = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'Outro cliente QA') returning id",
    [foreign],
  ),
);
const day = new Date(Date.now() + 9 * 86400000);
while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
const date = day.toISOString().slice(0, 10);
const at = (hour: number) =>
  `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`;
const save = "select save_class_session($1,$2,$3,$4,$5,$6,$7,$8,$9)";
const args = (hour: number, capacity = 2, published = true) => [
  company,
  null,
  null,
  service,
  professional,
  "Turma QA",
  at(hour),
  capacity,
  published,
];
await as(owner);
let session = "";
await check(
  "owner creates a bounded class without appointments or consuming professional seats",
  async () => {
    session = String(await scalar(save, args(10)));
    assert.equal(await scalar("select count(*) from appointments"), 0);
    assert.equal(await scalar("select count(*) from professionals"), 1);
    assert.equal(
      await scalar(
        "select extract(epoch from(ends_at-starts_at))::integer from class_sessions where id=$1",
        [session],
      ),
      3600,
    );
    await denied(save, args(12, 0), /invalid class/);
    await denied(save, args(12, 101), /invalid class/);
  },
);
await check(
  "class writes and foreign identities fail closed for every unprivileged role",
  async () => {
    for (const who of [other, employee, stranger, admin]) {
      await as(who);
      await denied(save, args(12), /not authorized/);
    }
    await as(null);
    await denied(save, args(12), /permission denied/);
    await as(owner);
    await denied(
      save,
      [
        ...args(12).slice(0, 3),
        foreignService,
        professional,
        "QA",
        at(12),
        2,
        true,
      ],
      /invalid class/,
    );
    await denied(
      save,
      [
        company,
        null,
        null,
        service,
        foreignProfessional,
        "QA",
        at(12),
        2,
        true,
      ],
      /invalid class/,
    );
    await denied(
      "insert into class_sessions(company_id,service_id,professional_id,title,starts_at,ends_at,capacity) values($1,$2,$3,'Bypass',$4,$5,100)",
      [company, service, professional, at(12), at(13)],
      /permission denied/,
    );
    await denied(
      "update class_sessions set capacity=100 where id=$1",
      [session],
      /permission denied/,
    );
  },
);
await check(
  "classes block individual booking, direct INSERT, reschedule, and all/professional blocks",
  async () => {
    await denied(
      "select book_appointment($1,$2,$3,$4,$5)",
      [company, customers[0], service, professional, at(10)],
      /schedule conflict/,
    );
    await denied(
      "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,$5,$6)",
      [company, customers[0], service, professional, at(10), at(11)],
      /schedule conflict/,
    );
    for (const p of [null, professional])
      await denied(
        "select create_schedule_block($1,$2,$3,$4,$5,'QA')",
        [company, randomUUID(), p, at(10), at(11)],
        /schedule conflict/,
      );
    const appointment = await scalar(
      "select book_appointment($1,$2,$3,$4,$5)",
      [company, customers[0], service, professional, at(9)],
    );
    await denied(
      "select manage_appointment($1,$2,'reschedule',$3)",
      [company, appointment, at(10)],
      /schedule conflict/,
    );
    await denied(save, args(9), /schedule conflict/);
    assert.equal(
      await scalar(
        "select starts_at=$2::timestamptz from appointments where id=$1",
        [appointment, at(9)],
      ),
      true,
    );
  },
);
await check(
  "existing blocks and classes reject overlap while adjacent classes work",
  async () => {
    const block = await scalar(
      "select create_schedule_block($1,$2,null,$3,$4,'QA')",
      [company, randomUUID(), at(12), at(13)],
    );
    await denied(save, args(12), /schedule conflict/);
    await denied(save, args(10), /schedule conflict/);
    await denied(save, args(7), /outside business hours/);
    await scalar(save, args(11, 3, false));
    await scalar("select remove_schedule_block($1,$2)", [company, block]);
  },
);
await check(
  "public listing has seats and no roster PII; individual public slots exclude classes",
  async () => {
    await as(null);
    const listed = (await scalar("select public_classes('classes-qa',$1)", [
      date,
    ])) as Record<string, unknown>[];
    assert.equal(listed.length, 1);
    assert.equal(listed[0].remaining, 2);
    for (const value of [
      customers[0],
      "Cliente QA",
      "11999990000",
      "company_id",
      "customer_id",
    ])
      assert.equal(JSON.stringify(listed).includes(value), false);
    assert.equal(
      await scalar(
        "select count(*) from public_slots('classes-qa',$1,$2,$3) where starts_at=$4",
        [service, professional, date, at(10)],
      ),
      0,
    );
    await denied("select * from class_registrations", [], /permission denied/);
    await denied(
      "select * from private.class_booking_requests",
      [],
      /permission denied/,
    );
    await as(other);
    assert.equal(await scalar("select count(*) from class_sessions"), 0);
  },
);
let registration = "";
const request = randomUUID();
await check(
  "manager registration is idempotent, capacity bound, and same-company only",
  async () => {
    await as(manager);
    registration = String(
      await scalar("select save_class_registration($1,$2,$3,$4)", [
        company,
        session,
        customers[0],
        request,
      ]),
    );
    assert.equal(
      await scalar("select save_class_registration($1,$2,$3,$4)", [
        company,
        session,
        customers[0],
        request,
      ]),
      registration,
    );
    await denied(
      "select save_class_registration($1,$2,$3,$4)",
      [company, session, customers[1], request],
      /idempotency conflict/,
    );
    await denied(
      "select save_class_registration($1,$2,$3,$4)",
      [company, session, foreignCustomer, randomUUID()],
      /invalid registration/,
    );
    await denied(
      "select save_class_registration($1,$2,$3,$4)",
      [company, session, customers[0], randomUUID()],
      /already reserved/,
    );
    await scalar("select save_class_registration($1,$2,$3,$4)", [
      company,
      session,
      customers[1],
      randomUUID(),
    ]);
    await denied(
      "select save_class_registration($1,$2,$3,$4)",
      [company, session, customers[2], randomUUID()],
      /class full/,
    );
    assert.equal(
      await scalar(
        "select count(*) from class_registrations where class_session_id=$1",
        [session],
      ),
      2,
    );
    await denied(
      save,
      [company, session, 1, service, professional, "Menor", at(10), 1, true],
      /class full/,
    );
  },
);
await check(
  "employee reads only assigned class roster and gains only its customer visibility",
  async () => {
    await as(employee);
    assert.equal(await scalar("select count(*) from class_registrations"), 2);
    assert.equal(
      await scalar("select count(*) from customers where id=$1", [
        customers[1],
      ]),
      1,
    );
    assert.equal(
      await scalar("select count(*) from customers where id=$1", [
        customers[2],
      ]),
      0,
    );
    await denied(
      "select save_class_registration($1,$2,$3,$4)",
      [company, session, customers[2], randomUUID()],
      /not authorized/,
    );
    await denied(
      "select manage_class_registration($1,$2,1,'cancel')",
      [company, registration],
      /not authorized/,
    );
    await denied(
      "select manage_class_registration($1,$2,1,'attend')",
      [company, registration],
      /has not started/,
    );
    await as(stranger);
    assert.equal(await scalar("select count(*) from class_sessions"), 0);
    assert.equal(await scalar("select count(*) from class_registrations"), 0);
    await as(other);
    assert.equal(await scalar("select count(*) from class_registrations"), 0);
    await denied(
      "select manage_class_registration($1,$2,1,'cancel')",
      [company, registration],
      /not authorized/,
    );
  },
);
await check(
  "canceling registration releases one seat and stale versions cannot overwrite",
  async () => {
    await as(owner);
    await scalar("select manage_class_registration($1,$2,1,'cancel')", [
      company,
      registration,
    ]);
    await denied(
      "select manage_class_registration($1,$2,1,'attend')",
      [company, registration],
      /version conflict/,
    );
    assert.equal(
      (
        (await scalar("select public_classes('classes-qa',$1)", [date])) as {
          remaining: number;
        }[]
      )[0].remaining,
      1,
    );
  },
);
const publicRequest = randomUUID();
let publicRegistration = "";
const publicArgs = [
  "classes-qa",
  session,
  "Cliente público QA",
  "11988887777",
  publicRequest,
  gateway,
  "a".repeat(64),
];
await check(
  "public reservation requires server capability, has strict idempotency and fills final seat",
  async () => {
    await as(null);
    for (const invalid of [null, "wrong"])
      await denied(
        "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
        [...publicArgs.slice(0, 5), invalid, publicArgs[6]],
        /gateway unauthorized/,
      );
    publicRegistration = String(
      await scalar(
        "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
        publicArgs,
      ),
    );
    assert.equal(
      await scalar(
        "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
        publicArgs,
      ),
      publicRegistration,
    );
    await denied(
      "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
      [...publicArgs.slice(0, 2), "Different", ...publicArgs.slice(3)],
      /idempotency conflict/,
    );
    await denied(
      "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
      [
        ...publicArgs.slice(0, 3),
        "11988887778",
        randomUUID(),
        gateway,
        "b".repeat(64),
      ],
      /class full/,
    );
    const receipt = (await scalar(
      "select public_class_booking_receipt($1,$2,$3)",
      ["classes-qa", publicRequest, gateway],
    )) as Record<string, unknown>;
    assert.equal(receipt.registration_id, publicRegistration);
    assert.equal(receipt.status, "reserved");
    assert.deepEqual(
      Object.keys(receipt).sort(),
      [
        "registration_id",
        "class_id",
        "title",
        "starts_at",
        "ends_at",
        "status",
        "class_status",
        "service_name",
        "professional_name",
        "company_name",
      ].sort(),
    );
    assert.equal(
      await scalar("select public_class_booking_receipt('other-slug',$1,$2)", [
        publicRequest,
        gateway,
      ]),
      null,
    );
  },
);
await check(
  "versioned edits preserve booked duration and archive guards preserve future classes",
  async () => {
    await as(owner);
    await scalar(save, [
      company,
      session,
      1,
      service,
      professional,
      "Turma atualizada",
      at(10),
      3,
      true,
    ]);
    await denied(
      save,
      [company, session, 1, service, professional, "Antigo", at(10), 3, true],
      /version conflict/,
    );
    for (const [section, id] of [
      ["services", service],
      ["professionals", professional],
      ["customers", customers[1]],
    ])
      await denied(
        "select archive_business_record($1,$2,$3,1,true)",
        [company, section, id],
        /future scheduled/,
      );
    await scalar(
      "select update_business_record($1,'services',$2,1,'Grupo QA',null,30,2500)",
      [company, service],
    );
    await scalar(save, [
      company,
      session,
      2,
      service,
      professional,
      "Turma atualizada",
      at(10),
      3,
      true,
    ]);
    assert.equal(
      await scalar(
        "select extract(epoch from(ends_at-starts_at))::integer from class_sessions where id=$1",
        [session],
      ),
      3600,
    );
  },
);
await check(
  "unpublishing hides discovery; canceled class releases time and preserves truthful receipt",
  async () => {
    await scalar(save, [
      company,
      session,
      3,
      service,
      professional,
      "Turma atualizada",
      at(10),
      3,
      false,
    ]);
    assert.deepEqual(
      await scalar("select public_classes('classes-qa',$1)", [date]),
      [],
    );
    await scalar("select manage_class_session($1,$2,4,'cancel')", [
      company,
      session,
    ]);
    assert.equal(
      await scalar(
        "select count(*) from class_registrations where class_session_id=$1 and status='reserved'",
        [session],
      ),
      0,
    );
    const receipt = (await scalar(
      "select public_class_booking_receipt('classes-qa',$1,$2)",
      [publicRequest, gateway],
    )) as { status: string; class_status: string };
    assert.equal(receipt.status, "canceled");
    assert.equal(receipt.class_status, "canceled");
    await scalar("select book_appointment($1,$2,$3,$4,$5)", [
      company,
      customers[2],
      service,
      professional,
      at(10),
    ]);
  },
);
await check(
  "blocked companies close class writes and catalogs but preserve the existing minimal receipt",
  async () => {
    for (const status of [
      "pending_card",
      "suspended",
      "past_due",
      "trialing",
    ]) {
      await db.exec("reset role");
      await db.query(
        "update companies set status=$2,trial_ends_at=case when $2='pending_card' then null else now()-interval '1 day' end where id=$1",
        [company, status],
      );
      await as(owner);
      await denied(save, args(14), /subscription blocked/);
      assert.deepEqual(
        await scalar("select public_classes('classes-qa',$1)", [date]),
        [],
      );
      await as(null);
      const receipt = (await scalar(
        "select public_class_booking_receipt('classes-qa',$1,$2)",
        [publicRequest, gateway],
      )) as Record<string, unknown>;
      assert.equal(receipt.registration_id, publicRegistration);
      assert.equal(receipt.status, "canceled");
      assert.equal(receipt.class_status, "canceled");
      assert.deepEqual(Object.keys(receipt).sort(), [
        "class_id",
        "class_status",
        "company_name",
        "ends_at",
        "professional_name",
        "registration_id",
        "service_name",
        "starts_at",
        "status",
        "title",
      ]);
      assert.equal(await scalar("select public_catalog('classes-qa')"), null);
      assert.equal(
        await scalar(
          "select public_class_booking_receipt('other-slug',$1,$2)",
          [publicRequest, gateway],
        ),
        null,
      );
      assert.equal(
        await scalar(
          "select public_class_booking_receipt('classes-qa',$1,$2)",
          [randomUUID(), gateway],
        ),
        null,
      );
      await denied(
        "select public_class_booking_receipt('classes-qa',$1,$2)",
        [publicRequest, "wrong-secret"],
        /gateway unauthorized/,
      );
      await denied(
        "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
        [...publicArgs.slice(0, 4), randomUUID(), gateway, "b".repeat(64)],
        /class unavailable/,
      );
    }
    await db.exec("reset role");
    await db.query(
      "update companies set status='trialing',trial_ends_at=now()+interval '7 days' where id=$1",
      [company],
    );
    await as(owner);
  },
);
await check(
  "unpublished booking page preserves only a stored class receipt",
  async () => {
    await db.exec("reset role");
    await db.query("update companies set booking_enabled=false where id=$1", [
      company,
    ]);
    await as(null);
    assert.equal(await scalar("select public_catalog('classes-qa')"), null);
    assert.deepEqual(
      await scalar("select public_classes('classes-qa',$1)", [date]),
      [],
    );
    const receipt = (await scalar(
      "select public_class_booking_receipt('classes-qa',$1,$2)",
      [publicRequest, gateway],
    )) as { registration_id: string; status: string };
    assert.equal(receipt.registration_id, publicRegistration);
    assert.equal(receipt.status, "canceled");
    await db.exec("reset role");
    await db.query("update companies set booking_enabled=true where id=$1", [
      company,
    ]);
    await as(owner);
  },
);
await check(
  "classes are enabled for all plans and every existing niche without extra professional allocation",
  async () => {
    for (const [i, plan] of [
      "essencial",
      "profissional",
      "empresarial",
    ].entries()) {
      await db.exec("reset role");
      await db.query("update companies set plan_id=$2 where id=$1", [
        company,
        plan,
      ]);
      await as(owner);
      const id = String(await scalar(save, args(13 + i, 5, false)));
      for (const customer of customers)
        await scalar("select save_class_registration($1,$2,$3,$4)", [
          company,
          id,
          customer,
          randomUUID(),
        ]);
      assert.equal(
        await scalar("select count(*) from professionals where company_id=$1", [
          company,
        ]),
        1,
      );
      await scalar("select manage_class_session($1,$2,1,'cancel')", [
        company,
        id,
      ]);
    }
    for (const niche of [
      "salao",
      "pet-shop",
      "clinica",
      "escritorio",
      "restaurante",
      "fornecedores",
      "logistica",
      "academia",
    ]) {
      await db.exec("reset role");
      await db.query("update companies set niche=$2 where id=$1", [
        company,
        niche,
      ]);
      await as(owner);
      const id = await scalar(save, args(16, 2, false));
      await scalar("select manage_class_session($1,$2,1,'cancel')", [
        company,
        id,
      ]);
    }
  },
);
await check(
  "hidden, foreign and distant classes cannot be reserved through the public gateway",
  async () => {
    await as(owner);
    const hidden = await scalar(
      "select id from class_sessions where company_id=$1 and starts_at=$2 and status='scheduled'",
      [company, at(11)],
    );
    await as(other);
    const foreignClass = await scalar(save, [
      foreign,
      null,
      null,
      foreignService,
      foreignProfessional,
      "Turma estrangeira QA",
      at(10),
      2,
      true,
    ]);
    await as(owner);
    const distantDay = new Date(day);
    distantDay.setUTCDate(distantDay.getUTCDate() + 70);
    const distantAt = `${distantDay.toISOString().slice(0, 10)}T10:00:00-03:00`;
    const distant = await scalar(save, [
      company,
      null,
      null,
      service,
      professional,
      "Turma distante QA",
      distantAt,
      2,
      true,
    ]);
    await as(null);
    for (const target of [hidden, foreignClass, distant])
      await denied(
        "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
        [
          "classes-qa",
          target,
          "Anônimo QA",
          "11988881111",
          randomUUID(),
          gateway,
          "c".repeat(64),
        ],
        /class unavailable/,
      );
    assert.deepEqual(
      await scalar("select public_classes('classes-qa',$1)", [
        distantDay.toISOString().slice(0, 10),
      ]),
      [],
    );
    await as(owner);
  },
);
await check(
  "public booking shares durable IP limits and denied requests leave no customer or seat behind",
  async () => {
    const limited = await scalar(save, args(14, 20, true));
    const before: number = Number(
      await scalar("select count(*) from customers"),
    );
    const savedRequests: string[] = [];
    await as(null);
    for (let i = 0; i < 10; i++) {
      const key = randomUUID();
      savedRequests.push(key);
      await scalar("select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)", [
        "classes-qa",
        limited,
        `Quota QA ${i}`,
        `119777700${String(i).padStart(2, "0")}`,
        key,
        gateway,
        "d".repeat(64),
      ]);
    }
    await denied(
      "select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)",
      [
        "classes-qa",
        limited,
        "Quota QA blocked",
        "11977770099",
        randomUUID(),
        gateway,
        "d".repeat(64),
      ],
      /limit/,
    );
    // A retry of the original reservation does not consume a second seat/quota.
    await scalar("select submit_public_class_booking($1,$2,$3,$4,$5,$6,$7)", [
      "classes-qa",
      limited,
      "Quota QA 0",
      "11977770000",
      savedRequests[0],
      gateway,
      "d".repeat(64),
    ]);
    await as(owner);
    assert.equal(await scalar("select count(*) from customers"), before + 10);
    assert.equal(
      await scalar(
        "select count(*) from class_registrations where class_session_id=$1",
        [limited],
      ),
      10,
    );
    await scalar("select manage_class_session($1,$2,1,'cancel')", [
      company,
      limited,
    ]);
  },
);
await check(
  "employee presence requires current assignment and started class; revocation removes roster access",
  async () => {
    const started = String(await scalar(save, args(17, 2, false)));
    const presence = await scalar(
      "select save_class_registration($1,$2,$3,$4)",
      [company, started, customers[3], randomUUID()],
    );
    await db.exec("reset role");
    await db.query(
      "update class_sessions set starts_at=now()-interval '20 minutes',ends_at=now()+interval '10 minutes' where id=$1",
      [started],
    );
    await as(employee);
    await scalar("select manage_class_registration($1,$2,1,'attend')", [
      company,
      presence,
    ]);
    assert.equal(
      await scalar("select status from class_registrations where id=$1", [
        presence,
      ]),
      "attended",
    );
    await as(owner);
    await denied(
      "select manage_class_session($1,$2,1,'complete')",
      [company, started],
      /has not ended/,
    );
    await denied(
      "select manage_class_session($1,$2,1,'cancel')",
      [company, started],
      /has attendance/,
    );
    await db.exec("reset role");
    await db.query(
      "update class_sessions set ends_at=now()-interval '1 minute' where id=$1",
      [started],
    );
    await as(manager);
    await scalar("select manage_class_session($1,$2,1,'complete')", [
      company,
      started,
    ]);
    assert.equal(
      await scalar("select status from class_sessions where id=$1", [started]),
      "completed",
    );
    await denied(
      save,
      [company, started, 2, service, professional, "Reabrir", at(17), 2, false],
      /class unavailable/,
    );
    await as(owner);
    await scalar("select revoke_company_member($1,$2,true)", [
      company,
      employee,
    ]);
    await as(employee);
    assert.equal(await scalar("select count(*) from class_sessions"), 0);
    assert.equal(await scalar("select count(*) from class_registrations"), 0);
    await denied(
      "select manage_class_registration($1,$2,2,'attend')",
      [company, presence],
      /not authorized/,
    );
  },
);
await db.exec("reset role");
await check(
  "all class tables use RLS and no public function is SECURITY DEFINER or PUBLIC executable",
  async () => {
    assert.equal(
      await scalar(
        "select count(*) from pg_class where relname in ('class_sessions','class_registrations','class_booking_requests') and relrowsecurity",
      ),
      3,
    );
    assert.equal(
      await scalar(
        "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%class%' and p.prosecdef",
      ),
      0,
    );
    assert.equal(
      await scalar(
        "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like '%class%' and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')",
      ),
      0,
    );
  },
);
await db.close();
console.log(
  `${checks} class database groups passed. Capacity/lock behavior checked serially; true concurrent connections require integration PostgreSQL.`,
);
