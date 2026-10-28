import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  socialInstant,
  socialMoney,
  adPlanSchema,
  captionOutputSchema,
  captionPrompt,
  validSocialJpeg,
} from "../src/lib/social/core";
import {
  makeSocialState,
  readSocialState,
  openSocialToken,
  sealSocialToken,
} from "../src/lib/social/crypto";
import {
  metaConfig,
  metaLoginUrl,
  metaRequest,
  publishSocialPhoto,
} from "../src/lib/social/meta";
import { runSocialJob, type SocialRpc } from "../src/lib/social/worker";
const encryption = Buffer.alloc(32, 7).toString("base64");
test("social clock uses selected zone and rejects invalid dates", () => {
  assert.equal(
    socialInstant("2027-01-10T09:30", "America/Sao_Paulo"),
    "2027-01-10T12:30:00.000Z",
  );
  assert.equal(
    socialInstant("2027-01-10T09:30", "America/Manaus"),
    "2027-01-10T13:30:00.000Z",
  );
  assert.equal(
    socialInstant("2027-01-10T09:30", "America/Rio_Branco"),
    "2027-01-10T14:30:00.000Z",
  );
  assert.equal(socialInstant("2027-02-30T09:30", "America/Sao_Paulo"), null);
  assert.equal(socialInstant("2027-01-10T09:30", "UTC"), null);
});
test("budget and proposal dates cannot become negative, NaN or invalid", () => {
  assert.equal(socialMoney("697,90"), 69790);
  for (const v of ["-1", "1e9", "1.000,00", "NaN", "0.001"])
    assert.equal(socialMoney(v), null);
  const v = {
    name: "TESTE campanha",
    objective: "traffic",
    ad_account_id: "12345678",
    media_budget_cents: 60000,
    management_fee_cents: 69700,
    start_date: "2027-01-10",
    end_date: "2027-01-20",
    notes: "TESTE fictício",
  };
  assert.ok(adPlanSchema.safeParse(v).success);
  assert.ok(!adPlanSchema.safeParse({ ...v, end_date: "2027-02-30" }).success);
});
test("JPEG requires bounded bytes and signature, not just extension", () => {
  const file = new Uint8Array(16);
  file.set([255, 216, 255]);
  file.set([255, 217], 14);
  assert.ok(validSocialJpeg(file));
  assert.ok(
    !validSocialJpeg(new TextEncoder().encode("<script>TEST</script>")),
  );
  assert.ok(!validSocialJpeg(new Uint8Array(1500001)));
});
test("caption output allows five plain hashtags; prompts treat brief as untrusted", () => {
  assert.ok(
    captionOutputSchema.safeParse({
      caption: "Uma legenda fictícia revisável.",
      hashtags: ["#NegócioLocal"],
    }).success,
  );
  assert.ok(
    !captionOutputSchema.safeParse({
      caption: "Uma legenda fictícia revisável.",
      hashtags: ["#link<script>"],
    }).success,
  );
  assert.ok(
    !captionOutputSchema.safeParse({
      caption: "Uma legenda fictícia revisável.",
      hashtags: Array(6).fill("#teste"),
    }).success,
  );
  assert.ok(
    captionPrompt("TESTE", "email@example.invalid").prompt.includes(
      "[contato removido]",
    ),
  );
});
test("encrypted token is bound to company/account; plaintext never persists", () => {
  const value = sealSocialToken(
    "TESTE_TOKEN_FICTICIO",
    "empresa-a:instagram:12345678",
    encryption,
  );
  assert.ok(!value.includes("TESTE_TOKEN"));
  assert.equal(
    openSocialToken(value, "empresa-a:instagram:12345678", encryption),
    "TESTE_TOKEN_FICTICIO",
  );
  assert.throws(() =>
    openSocialToken(value, "empresa-b:instagram:12345678", encryption),
  );
  assert.throws(() =>
    openSocialToken(
      value.replace(/.$/, "!"),
      "empresa-a:instagram:12345678",
      encryption,
    ),
  );
});
test("OAuth state rejects CSRF, replay expiry, user mismatch and tampering", () => {
  const user = randomUUID(),
    input = {
      user,
      company: randomUUID(),
      network: "instagram" as const,
      page: "12345678",
    };
  const state = makeSocialState(input, encryption, 1000);
  assert.equal(
    readSocialState(state, state, user, encryption, 2000)?.company,
    input.company,
  );
  assert.equal(readSocialState(state, "other", user, encryption, 2000), null);
  assert.equal(
    readSocialState(state, state, randomUUID(), encryption, 2000),
    null,
  );
  assert.equal(readSocialState(state, state, user, encryption, 700000), null);
  assert.equal(
    readSocialState(`${state}x`, `${state}x`, user, encryption, 2000),
    null,
  );
});
test("Meta config requires explicit HTTPS canonical origin/version", () => {
  const env = {
    META_APP_ID: "12345678",
    META_APP_SECRET: "TESTE_SECRET",
    META_GRAPH_VERSION: "v24.0",
    APP_URL: "https://test.example.invalid",
  };
  assert.ok(metaConfig(env));
  assert.equal(
    metaConfig({ ...env, APP_URL: "https://evil.invalid/path" }),
    null,
  );
  assert.equal(metaConfig({ ...env, APP_URL: "http://localhost:3000" }), null);
  const url = new URL(metaLoginUrl(metaConfig(env)!, "state"));
  assert.equal(url.hostname, "www.facebook.com");
  assert.ok(!url.searchParams.has("client_secret"));
});
test("Graph adapter never follows arbitrary URLs or returns raw provider failures", async () => {
  const transport = async () =>
    new Response('{"error":{"message":"TESTE secret"}}', { status: 400 });
  await assert.rejects(
    metaRequest(
      { version: "v24.0" },
      "https://evil.invalid",
      {},
      "TESTE",
      "GET",
      transport as typeof fetch,
    ),
    /INVALID_REQUEST/,
  );
  await assert.rejects(
    metaRequest(
      { version: "v24.0" },
      "12345678",
      {},
      "TESTE",
      "GET",
      transport as typeof fetch,
    ),
    /META_REJECTED/,
  );
});
test("Instagram publication performs create/check/publish exactly once, with no token in URL", async () => {
  const calls: string[] = [],
    answers = [
      { id: "12345678" },
      { status_code: "FINISHED" },
      { id: "98765432" },
    ];
  const transport = async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push(String(url));
    assert.ok(!String(url).includes("TOKEN"));
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer TESTE_TOKEN",
    );
    return Response.json(answers.shift());
  };
  const id = await publishSocialPhoto(
    {
      version: "v24.0",
      network: "instagram",
      externalId: "12345678",
      token: "TESTE_TOKEN",
      imageUrl: "https://media.example.invalid/test.jpg",
      caption: "TESTE",
      altText: "TESTE",
    },
    transport as typeof fetch,
  );
  assert.equal(id, "98765432");
  assert.equal(calls.length, 3);
  assert.ok(calls[2].endsWith("/media_publish"));
});
test("not-ready media and publication timeouts never cause an automatic retry", async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return Response.json(
      calls === 1 ? { id: "12345678" } : { status_code: "IN_PROGRESS" },
    );
  };
  await assert.rejects(
    publishSocialPhoto(
      {
        version: "v24.0",
        network: "instagram",
        externalId: "12345678",
        token: "TESTE",
        imageUrl: "https://media.example.invalid/test.jpg",
        caption: "TESTE",
        altText: "TESTE",
      },
      transport as typeof fetch,
    ),
    /NOT_READY/,
  );
  assert.equal(calls, 2);
});
test("worker reports uncertain delivery durably and refuses cross-company assets", async () => {
  const id = randomUUID(),
    company = randomUUID(),
    attempt = randomUUID();
  const job = {
    id,
    company_id: company,
    attempt_id: attempt,
    network: "instagram",
    external_id: "12345678",
    caption: "TESTE",
    alt_text: "TESTE",
    asset_path: `${company}/${id}.jpg`,
    encrypted_token: sealSocialToken(
      "TESTE",
      `${company}:instagram:12345678`,
      encryption,
    ),
  };
  const completed: Record<string, unknown>[] = [];
  const rpc: SocialRpc = async (name, args) =>
    name === "social_claim"
      ? { data: job, error: null }
      : (completed.push(args), { data: null, error: null });
  let calls = 0;
  const output = await runSocialJob({
    rpc,
    secret: null,
    version: "v24.0",
    encryption,
    assetUrl: async () => "https://media.example.invalid/test.jpg",
    publish: async () => {
      calls++;
      throw new Error("timeout");
    },
  });
  assert.equal(calls, 1);
  assert.equal(output.status, "unknown");
  assert.equal(completed[0].p_status, "unknown");
  job.asset_path = `${randomUUID()}/${id}.jpg`;
  await assert.rejects(
    runSocialJob({
      rpc,
      secret: null,
      version: "v24.0",
      encryption,
      assetUrl: async () => {
        throw new Error("must not sign");
      },
    }),
    /ASSET_MISMATCH/,
  );
});
