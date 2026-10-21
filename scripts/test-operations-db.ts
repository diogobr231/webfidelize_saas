import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { storageFixture } from "./storage-fixture";

// Disposable PostgreSQL only. No network, real accounts or remote mutations.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
await db.exec(storageFixture);
for (const file of (await readdir("supabase/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
}
async function scalar(sql: string, args: unknown[] = []) {
  const { rows } = await db.query<Record<string, unknown>>(sql, args);
  return Object.values(rows[0])[0];
}
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    user || "",
  ]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
async function denied(sql: string, args: unknown[], expected: RegExp) {
  await assert.rejects(() => db.query(sql, args), expected);
}
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS operations: ${name}`);
}
const owner = randomUUID(),
  other = randomUUID(),
  manager = randomUUID(),
  employee = randomUUID(),
  extra = randomUUID(),
  admin = randomUUID();
for (const [id, name] of [
  [owner, "owner"],
  [other, "other"],
  [manager, "manager"],
  [employee, "employee"],
  [extra, "extra"],
  [admin, "admin"],
]) {
  await db.query("insert into auth.users values($1,$2,now())", [
    id,
    `${name}@example.invalid`,
  ]);
}
await as(owner);
const company = String(
  await scalar("select create_company('Operações A teste','salao')"),
);
await as(other);
const foreign = String(
  await scalar("select create_company('Operações B teste','salao')"),
);
await db.exec("reset role");
await db.query(
  "update companies set plan_id='profissional', booking_slug='operations-demo', booking_enabled=true, is_demo=true where id=$1",
  [company],
);
await db.query(
  "insert into memberships values($1,$2,'MANAGER'),($1,$3,'EMPLOYEE'),($1,$4,'EMPLOYEE')",
  [company, manager, employee, extra],
);
await db.query("insert into private.platform_admins values($1)", [admin]);
const gateway = "local-disposable-operations-fixture";
await db.query(
  "insert into private.booking_gateway(secret_hash) values(encode(sha256(convert_to($1,'UTF8')),'hex'))",
  [gateway],
);
await as(owner);
const customer = String(
  await scalar(
    "insert into customers(company_id,name,phone) values($1,'Cliente operacional','11999990001') returning id",
    [company],
  ),
);
const customer2 = String(
  await scalar(
    "insert into customers(company_id,name,phone) values($1,'Cliente sem reserva','11999990002') returning id",
    [company],
  ),
);
const service = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Serviço operacional',30,5000) returning id",
    [company],
  ),
);
const service2 = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Serviço secundário',30,3000) returning id",
    [company],
  ),
);
const professional = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional vinculado') returning id",
    [company],
  ),
);
const professional2 = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional secundário') returning id",
    [company],
  ),
);
await db.query("select assign_professional_member($1,$2,$3,null,false)", [
  company,
  professional,
  employee,
]);
await as(other);
const foreignCustomer = String(
  await scalar(
    "insert into customers(company_id,name) values($1,'Cliente B') returning id",
    [foreign],
  ),
);
const foreignService = String(
  await scalar(
    "insert into services(company_id,name,duration_minutes,price_cents) values($1,'Serviço B',30,1000) returning id",
    [foreign],
  ),
);
const foreignProfessional = String(
  await scalar(
    "insert into professionals(company_id,name) values($1,'Profissional B') returning id",
    [foreign],
  ),
);
await as(owner);
const day = String(
  await scalar(
    "select (current_date + (8 - extract(isodow from current_date)::int))::text",
  ),
);
const time = (hour: number, minute = 0) =>
  `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`;
const book = (p: string, hour: number, minute = 0, c = customer, s = service) =>
  scalar("select book_appointment($1,$2,$3,$4,$5)", [
    company,
    c,
    s,
    p,
    time(hour, minute),
  ]);
const archive = (section: string, id: string, version: number, state = true) =>
  scalar("select archive_business_record($1,$2,$3,$4,$5)", [
    company,
    section,
    id,
    version,
    state,
  ]);
const update = (
  section: string,
  id: string,
  version: number,
  name: string,
  phone: string | null = null,
  duration: number | null = null,
  price: number | null = null,
) =>
  scalar("select update_business_record($1,$2,$3,$4,$5,$6,$7,$8)", [
    company,
    section,
    id,
    version,
    name,
    phone,
    duration,
    price,
  ]);
const block = (
  id: string,
  p: string | null,
  from: string,
  until: string,
  reason = "Ausência interna",
) =>
  scalar("select create_schedule_block($1,$2,$3,$4,$5,$6)", [
    company,
    id,
    p,
    from,
    until,
    reason,
  ]);
const slot = async (p: string, hour: number, minute = 0, s = service) =>
  Number(
    await scalar(
      "select count(*) from public_slots('operations-demo',$1,$2,$3) where starts_at=$4",
      [s, p, day, time(hour, minute)],
    ),
  );

await check(
  "owner/manager edit, trim, monotonic version and no-op",
  async () => {
    assert.equal(
      await scalar("select record_version from customers where id=$1", [
        customer,
      ]),
      1,
    );
    assert.equal(
      await update(
        "customers",
        customer,
        1,
        " Cliente atualizado ",
        "11999990001",
      ),
      2,
    );
    assert.equal(
      await update(
        "customers",
        customer,
        2,
        "Cliente atualizado",
        "11999990001",
      ),
      2,
    );
    await as(manager);
    assert.equal(
      await update(
        "services",
        service2,
        1,
        "Serviço secundário atualizado",
        null,
        45,
        3500,
      ),
      2,
    );
    assert.equal(
      await update(
        "professionals",
        professional2,
        1,
        "Profissional atualizado",
      ),
      2,
    );
    await as(owner);
    assert.equal(
      await scalar("select name from customers where id=$1", [customer]),
      "Cliente atualizado",
    );
  },
);
await check(
  "stale writes and archive versions never overwrite changes",
  async () => {
    await assert.rejects(
      () => update("customers", customer, 1, "Desatualizado", ""),
      /record version conflict/,
    );
    await assert.rejects(
      () => archive("professionals", professional2, 1),
      /record version conflict/,
    );
    assert.equal(
      await scalar("select record_version from professionals where id=$1", [
        professional2,
      ]),
      2,
    );
  },
);
await check(
  "database validates sections and every editable field",
  async () => {
    await assert.rejects(
      () => update("companies", company, 1, "Injeção"),
      /invalid business record/,
    );
    await assert.rejects(
      () => update("customers", customer, 2, " ", ""),
      /invalid business record/,
    );
    await assert.rejects(
      () => update("customers", customer, 2, "Cliente", "x".repeat(31)),
      /invalid business record/,
    );
    await assert.rejects(
      () => update("customers", customer, 2, "Cliente", "", 30),
      /invalid business record/,
    );
    for (const [duration, price] of [
      [4, 0],
      [481, 0],
      [30, -1],
      [30, 10000001],
    ]) {
      await assert.rejects(
        () => update("services", service, 1, "Serviço", null, duration, price),
        /invalid business record/,
      );
    }
    await assert.rejects(
      () =>
        update("professionals", professional, 1, "Profissional", "telefone"),
      /invalid business record/,
    );
    await denied(
      "select archive_business_record($1,'customers',$2,null,true)",
      [company, customer],
      /invalid business record/,
    );
  },
);
await check("cross-company and employee/anonymous write denial", async () => {
  await assert.rejects(
    () => update("customers", foreignCustomer, 1, "Ataque", ""),
    /record unavailable/,
  );
  await denied(
    "select archive_business_record($1,'services',$2,1,true)",
    [foreign, foreignService],
    /not authorized/,
  );
  for (const actor of [employee, other, null]) {
    await as(actor);
    await assert.rejects(
      () => update("customers", customer, 2, "Ataque", ""),
      /not authorized|permission denied/,
    );
    await assert.rejects(
      () => archive("services", service, 1),
      /not authorized|permission denied/,
    );
    await assert.rejects(
      () => block(randomUUID(), null, time(9), time(10)),
      /not authorized|permission denied/,
    );
  }
  await as(owner);
});
await check(
  "Data API cannot inject archive/version/assignment or mutate/delete records",
  async () => {
    await denied(
      "insert into customers(company_id,name,archived_at) values($1,'Ataque',now())",
      [company],
      /permission denied/,
    );
    await denied(
      "insert into services(company_id,name,duration_minutes,price_cents,record_version) values($1,'Ataque',30,0,9)",
      [company],
      /permission denied/,
    );
    await denied(
      "insert into professionals(company_id,name,archived_at) values($1,'Ataque',now())",
      [company],
      /permission denied/,
    );
    for (const table of ["customers", "services", "professionals"]) {
      await denied(
        `update ${table} set company_id=$1`,
        [foreign],
        /permission denied/,
      );
      await denied(`delete from ${table}`, [], /permission denied/);
    }
  },
);
await check(
  "Data API cannot forge terminal status; normal scheduled creation remains available",
  async () => {
    for (const status of ["completed", "canceled", "scheduled"]) {
      await denied(
        "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at,status) values($1,$2,$3,$4,$5,$6,$7)",
        [
          company,
          customer,
          service,
          professional,
          time(17),
          time(17, 30),
          status,
        ],
        /permission denied/,
      );
    }
    const inserted = String(
      await scalar(
        "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,$5,$6) returning id",
        [company, customer, service, professional, time(17), time(17, 30)],
      ),
    );
    assert.equal(
      await scalar("select status from appointments where id=$1", [inserted]),
      "scheduled",
    );
    await db.query("select manage_appointment($1,$2,'cancel',null)", [
      company,
      inserted,
    ]);
    await as(employee);
    await denied(
      "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,$5,$6)",
      [company, customer, service, professional, time(17), time(17, 30)],
      /not authorized/,
    );
    await as(owner);
  },
);
const appointment = String(await book(professional, 10));
await check(
  "scheduled appointments prevent archive of each related record",
  async () => {
    for (const [section, id, version] of [
      ["customers", customer, 2],
      ["services", service, 1],
      ["professionals", professional, 1],
    ] as const) {
      await assert.rejects(
        () => archive(section, id, version),
        /future scheduled appointments/,
      );
    }
  },
);
await check(
  "editing a service never changes booked duration or appointment identity",
  async () => {
    const original = await scalar(
      "select row_to_json(a) from appointments a where id=$1",
      [appointment],
    );
    await update("services", service, 1, "Serviço editado", null, 60, 9000);
    assert.deepEqual(
      await scalar("select row_to_json(a) from appointments a where id=$1", [
        appointment,
      ]),
      original,
    );
    await db.query("select manage_appointment($1,$2,'reschedule',$3)", [
      company,
      appointment,
      time(11),
    ]);
    assert.equal(
      Number(
        await scalar(
          "select extract(epoch from ends_at-starts_at)/60 from appointments where id=$1",
          [appointment],
        ),
      ),
      30,
    );
    await update("services", service, 2, "Serviço operacional", null, 30, 5000);
  },
);
await check(
  "archive/reactivate/no-op retain records and historical relationships",
  async () => {
    await db.query("select manage_appointment($1,$2,'cancel',null)", [
      company,
      appointment,
    ]);
    assert.equal(await archive("customers", customer, 2), 3);
    assert.equal(await archive("customers", customer, 3), 3);
    await assert.rejects(
      () => update("customers", customer, 3, "Ignorado", ""),
      /record archived/,
    );
    assert.equal(
      await scalar("select customer_id from appointments where id=$1", [
        appointment,
      ]),
      customer,
    );
    assert.equal(await archive("customers", customer, 3, false), 4);
    assert.equal(await archive("customers", customer, 4, false), 4);
  },
);
await check(
  "archived customer/service/professional rejected by RPC and direct inserts",
  async () => {
    for (const [section, id, version] of [
      ["customers", customer2, 1],
      ["services", service2, 2],
      ["professionals", professional2, 2],
    ] as const) {
      await archive(section, id, version);
      const c = section === "customers" ? customer2 : customer;
      const s = section === "services" ? service2 : service;
      const p = section === "professionals" ? professional2 : professional;
      await assert.rejects(
        () => book(p, 13, 0, c, s),
        /record unavailable|invalid service/,
      );
      await denied(
        "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,$5,$6)",
        [company, c, s, p, time(13), time(13, 30)],
        /record unavailable|invalid service/,
      );
    }
  },
);
await check(
  "public catalog and slots omit archived but RLS history keeps them",
  async () => {
    await as(null);
    const catalog = (await scalar(
      "select public_catalog('operations-demo')",
    )) as { services: { id: string }[]; professionals: { id: string }[] };
    assert.deepEqual(
      catalog.services.map((x) => x.id),
      [service],
    );
    assert.deepEqual(
      catalog.professionals.map((x) => x.id),
      [professional],
    );
    assert.equal(await slot(professional2, 13), 0);
    assert.equal(await slot(professional, 13, 0, service2), 0);
    assert.equal(await slot(professional, 13), 1);
    await as(owner);
    assert.equal(
      Number(
        await scalar("select count(*) from services where id=$1", [service2]),
      ),
      1,
    );
    await as(other);
    assert.equal(
      Number(
        await scalar("select count(*) from customers where company_id=$1", [
          company,
        ]),
      ),
      0,
    );
    await as(owner);
  },
);
await check(
  "only active professionals consume plan capacity; restore is atomic",
  async () => {
    const p3 = String(
      await scalar(
        "insert into professionals(company_id,name) values($1,'Terceiro ativo') returning id",
        [company],
      ),
    );
    const p4 = String(
      await scalar(
        "insert into professionals(company_id,name) values($1,'Quarto total terceiro ativo') returning id",
        [company],
      ),
    );
    await denied(
      "insert into professionals(company_id,name) values($1,'Além do limite')",
      [company],
      /professional limit reached/,
    );
    await assert.rejects(
      () => archive("professionals", professional2, 3, false),
      /professional limit reached/,
    );
    assert.equal(
      await scalar(
        "select archived_at is not null and record_version=3 from professionals where id=$1",
        [professional2],
      ),
      true,
    );
    await archive("professionals", p4, 1);
    assert.equal(await archive("professionals", professional2, 3, false), 4);
    await archive("professionals", professional2, 4);
    await archive("professionals", p3, 1);
  },
);
await check(
  "archived assignment preserves employee history; unlink/revoke remain separate",
  async () => {
    await archive("professionals", professional, 1);
    await as(employee);
    assert.equal(
      await scalar("select id from professionals where company_id=$1", [
        company,
      ]),
      professional,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where id=$1", [
          appointment,
        ]),
      ),
      1,
    );
    await as(owner);
    await denied(
      "select assign_professional_member($1,$2,$3,$4,true)",
      [company, professional, extra, employee],
      /professional archived/,
    );
    await db.query("select assign_professional_member($1,$2,null,$3,true)", [
      company,
      professional,
      employee,
    ]);
    assert.equal(
      await scalar("select user_id from professionals where id=$1", [
        professional,
      ]),
      null,
    );
    await archive("professionals", professional, 2, false);
    await db.query("select assign_professional_member($1,$2,$3,null,false)", [
      company,
      professional,
      employee,
    ]);
  },
);
const personalBlock = randomUUID(),
  globalBlock = randomUUID();
await check(
  "manager creates idempotent block; changed UUID payload conflicts",
  async () => {
    await as(manager);
    assert.equal(
      await block(personalBlock, professional, time(12), time(13)),
      personalBlock,
    );
    assert.equal(
      await block(personalBlock, professional, time(12), time(13)),
      personalBlock,
    );
    await assert.rejects(
      () => block(personalBlock, professional, time(12), time(14)),
      /block idempotency conflict/,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from schedule_blocks where id=$1", [
          personalBlock,
        ]),
      ),
      1,
    );
    await block(
      globalBlock,
      null,
      time(15),
      time(16),
      "Fechado para reunião privada",
    );
    await as(owner);
  },
);
await check(
  "block interval, reason, professional tenant/active and direct API validation",
  async () => {
    for (const [from, until] of [
      [time(13), time(12)],
      [time(13), time(13)],
      ["-infinity", time(13)],
      [time(12), "infinity"],
      ["2020-01-01T10:00Z", "2020-01-01T11:00Z"],
    ]) {
      await assert.rejects(
        () => block(randomUUID(), null, from, until),
        /invalid block interval/,
      );
    }
    await assert.rejects(
      () => block(randomUUID(), null, time(13), time(14), "x".repeat(161)),
      /invalid block reason/,
    );
    await assert.rejects(
      () => block(randomUUID(), foreignProfessional, time(13), time(14)),
      /professional unavailable/,
    );
    await assert.rejects(
      () => block(randomUUID(), professional2, time(13), time(14)),
      /professional unavailable/,
    );
    await denied(
      "insert into schedule_blocks(id,company_id,starts_at,ends_at) values($1,$2,$3,$4)",
      [randomUUID(), company, time(13), time(14)],
      /permission denied/,
    );
    await denied(
      "update schedule_blocks set reason='Ataque'",
      [],
      /permission denied/,
    );
    await denied("delete from schedule_blocks", [], /permission denied/);
  },
);
await check(
  "block reads are scoped to company and assigned employee; no anonymous reasons",
  async () => {
    await archive("professionals", professional2, 5, false);
    const otherBlock = randomUUID();
    await block(
      otherBlock,
      professional2,
      time(12),
      time(13),
      "Privado outro profissional",
    );
    await as(employee);
    const mine = await db.query<{ id: string }>(
      "select id from schedule_blocks order by id",
    );
    assert.deepEqual(
      mine.rows.map((x) => x.id).sort(),
      [personalBlock, globalBlock].sort(),
    );
    await denied(
      "select remove_schedule_block($1,$2)",
      [company, personalBlock],
      /not authorized/,
    );
    await as(other);
    assert.equal(
      Number(await scalar("select count(*) from schedule_blocks")),
      0,
    );
    await denied(
      "select remove_schedule_block($1,$2)",
      [foreign, personalBlock],
      /block unavailable/,
    );
    await as(null);
    await denied("select reason from schedule_blocks", [], /permission denied/);
    assert.equal(
      JSON.stringify(
        await scalar("select public_catalog('operations-demo')"),
      ).includes("reunião"),
      false,
    );
    await as(owner);
    await db.query("select remove_schedule_block($1,$2)", [
      company,
      otherBlock,
    ]);
  },
);
await check(
  "personal/global blocks affect slots, RPC and direct bookings with half-open boundaries",
  async () => {
    await as(null);
    assert.equal(await slot(professional, 12), 0);
    assert.equal(await slot(professional2, 12), 1);
    assert.equal(await slot(professional, 11, 30), 1);
    assert.equal(await slot(professional, 13), 1);
    assert.equal(await slot(professional2, 15), 0);
    await as(owner);
    await assert.rejects(() => book(professional, 12), /schedule blocked/);
    await assert.rejects(() => book(professional2, 15), /schedule blocked/);
    await denied(
      "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,$5,$6)",
      [company, customer, service, professional, time(12), time(12, 30)],
      /schedule blocked/,
    );
    const before = String(await book(professional, 11, 30));
    const after = String(await book(professional, 13));
    await denied(
      "select manage_appointment($1,$2,'reschedule',$3)",
      [company, after, time(12)],
      /schedule blocked/,
    );
    assert.equal(
      await scalar(
        "select starts_at=$2::timestamptz from appointments where id=$1",
        [after, time(13)],
      ),
      true,
    );
    await db.query("select manage_appointment($1,$2,'cancel',null)", [
      company,
      before,
    ]);
    await db.query("select manage_appointment($1,$2,'cancel',null)", [
      company,
      after,
    ]);
  },
);
await check(
  "existing scheduled reservation rejects personal and global blocking atomically",
  async () => {
    const existing = String(await book(professional, 9));
    await assert.rejects(
      () => block(randomUUID(), professional, time(9), time(10)),
      /scheduled appointment conflict/,
    );
    await assert.rejects(
      () => block(randomUUID(), null, time(8), time(10)),
      /scheduled appointment conflict/,
    );
    const independent = randomUUID();
    await block(independent, professional2, time(9), time(10));
    assert.equal(
      await scalar("select status from appointments where id=$1", [existing]),
      "scheduled",
    );
    await db.query("select remove_schedule_block($1,$2)", [
      company,
      independent,
    ]);
    await db.query("select manage_appointment($1,$2,'cancel',null)", [
      company,
      existing,
    ]);
  },
);
await check(
  "gateway refuses secret/archived/blocked requests without creating customers",
  async () => {
    const before = Number(
      await scalar("select count(*) from customers where company_id=$1", [
        company,
      ]),
    );
    const submit =
      "select submit_public_booking('operations-demo',$1,$2,$3,'Cliente público','11999990002',$4,$5,$6)";
    await as(null);
    await denied(
      submit,
      [
        service,
        professional,
        time(14),
        randomUUID(),
        "invalid",
        "a".repeat(64),
      ],
      /gateway unauthorized/,
    );
    await denied(
      submit,
      [service2, professional, time(14), randomUUID(), gateway, "a".repeat(64)],
      /slot unavailable/,
    );
    await denied(
      submit,
      [service, professional, time(12), randomUUID(), gateway, "a".repeat(64)],
      /slot unavailable/,
    );
    await denied(
      submit,
      [service, professional2, time(15), randomUUID(), gateway, "a".repeat(64)],
      /slot unavailable/,
    );
    await as(owner);
    assert.equal(
      Number(
        await scalar("select count(*) from customers where company_id=$1", [
          company,
        ]),
      ),
      before,
    );
  },
);
await check(
  "public booking creates active customer without resurrecting archived phone; old receipt/retry survives archive",
  async () => {
    const request = randomUUID();
    const args = [
      service,
      professional,
      time(14),
      request,
      gateway,
      "b".repeat(64),
    ];
    const sql =
      "select submit_public_booking('operations-demo',$1,$2,$3,'Cliente público','11999990002',$4,$5,$6)";
    await as(null);
    const created = String(await scalar(sql, args));
    assert.equal(await scalar(sql, args), created);
    await as(owner);
    assert.equal(
      await scalar(
        "select archived_at is not null from customers where id=$1",
        [customer2],
      ),
      true,
    );
    assert.notEqual(
      await scalar("select customer_id from appointments where id=$1", [
        created,
      ]),
      customer2,
    );
    await db.query("select manage_appointment($1,$2,'cancel',null)", [
      company,
      created,
    ]);
    await archive("services", service, 3);
    await archive("professionals", professional, 3);
    await as(null);
    assert.equal(await scalar(sql, args), created);
    const receipt = (await scalar(
      "select public_booking_receipt('operations-demo',$1,$2)",
      [request, gateway],
    )) as { id: string };
    assert.equal(receipt.id, created);
    await denied(
      sql,
      [service, professional, time(14), randomUUID(), gateway, "c".repeat(64)],
      /slot unavailable/,
    );
    await as(owner);
    await archive("services", service, 4, false);
    await archive("professionals", professional, 4, false);
  },
);
await check(
  "removing a block reopens slots without changing existing appointments",
  async () => {
    const snapshot = await scalar(
      "select jsonb_agg(to_jsonb(a) order by id) from appointments a where company_id=$1",
      [company],
    );
    await as(manager);
    await db.query("select remove_schedule_block($1,$2)", [
      company,
      personalBlock,
    ]);
    assert.equal(await slot(professional, 12), 1);
    await denied(
      "select remove_schedule_block($1,$2)",
      [company, personalBlock],
      /block unavailable/,
    );
    assert.deepEqual(
      await scalar(
        "select jsonb_agg(to_jsonb(a) order by id) from appointments a where company_id=$1",
        [company],
      ),
      snapshot,
    );
    await as(owner);
  },
);
await check(
  "expired/past_due/suspended companies cannot edit, archive, block or book",
  async () => {
    for (const status of ["trialing", "past_due", "suspended"]) {
      await db.exec("reset role");
      await db.query(
        "update companies set status=$2, trial_ends_at=now()-interval '1 day' where id=$1",
        [company, status],
      );
      await as(owner);
      await assert.rejects(
        () => update("customers", customer, 4, "Cliente", ""),
        /subscription blocked/,
      );
      await assert.rejects(
        () => archive("customers", customer, 4),
        /subscription blocked/,
      );
      await assert.rejects(
        () => block(randomUUID(), null, time(13), time(14)),
        /subscription blocked/,
      );
      await denied(
        "select remove_schedule_block($1,$2)",
        [company, globalBlock],
        /subscription blocked/,
      );
      await assert.rejects(
        () => book(professional, 13),
        /not authorized|subscription blocked/,
      );
      await denied(
        "insert into appointments(company_id,customer_id,service_id,professional_id,starts_at,ends_at) values($1,$2,$3,$4,$5,$6)",
        [company, customer, service, professional, time(13), time(13, 30)],
        /subscription blocked/,
      );
      await as(null);
      assert.equal(
        await scalar("select public_catalog('operations-demo')"),
        null,
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
  "revocation of archived professional remains possible after expiration and preserves history",
  async () => {
    await archive("professionals", professional, 5);
    await db.exec("reset role");
    await db.query("update companies set status='suspended' where id=$1", [
      company,
    ]);
    await as(owner);
    await db.query("select revoke_company_member($1,$2,true)", [
      company,
      employee,
    ]);
    assert.equal(
      await scalar("select user_id from professionals where id=$1", [
        professional,
      ]),
      null,
    );
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where id=$1", [
          appointment,
        ]),
      ),
      1,
    );
    await as(employee);
    assert.equal(
      Number(
        await scalar("select count(*) from appointments where company_id=$1", [
          company,
        ]),
      ),
      0,
    );
    await db.exec("reset role");
    await db.query("update companies set status='trialing' where id=$1", [
      company,
    ]);
    await as(owner);
  },
);
await check(
  "admin plan changes count active professionals while membership capacity stays intact",
  async () => {
    await db.query("select revoke_company_member($1,$2,true)", [
      company,
      extra,
    ]);
    await as(admin);
    // One active professional and one non-owner membership; archived rows stay.
    await db.query(
      "select admin_company($1,'essencial','trialing',now()+interval '7 days')",
      [company],
    );
    await as(owner);
    await assert.rejects(
      () => archive("professionals", professional, 6, false),
      /professional limit reached/,
    );
    assert.equal(
      await scalar("select plan_id from companies where id=$1", [company]),
      "essencial",
    );
  },
);
await check(
  "all competing write paths use one company row-lock strategy",
  async () => {
    await db.exec("reset role");
    for (const signature of [
      "private.lock_business_company(uuid)",
      "private.validate_appointment()",
      "private.submit_public_booking(text,uuid,uuid,timestamp with time zone,text,text,uuid,text,text)",
    ]) {
      const body = String(
        await scalar("select pg_get_functiondef($1::regprocedure)", [
          signature,
        ]),
      );
      assert.match(body, /from public\.companies[\s\S]*?for update/i);
    }
    for (const signature of [
      "private.archive_business_record(uuid,text,uuid,integer,boolean)",
      "private.create_schedule_block(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)",
    ]) {
      assert.match(
        String(
          await scalar("select pg_get_functiondef($1::regprocedure)", [
            signature,
          ]),
        ),
        /perform private\.lock_business_company\(p_company\)/,
      );
    }
    // PGlite has a single connection: ordering/invariants and lock usage are tested,
    // but this is explicitly not a multi-session PostgreSQL race benchmark.
  },
);
await db.close();
console.log(`${checks} operations database groups passed (disposable PGlite).`);
