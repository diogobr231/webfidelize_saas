import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiOutputSchema,
  buildAiPrompt,
  classifyAiFailure,
  redactAiText,
} from "../src/lib/admin-ai/core";
import { runAiBatch, type AiRpc } from "../src/lib/admin-ai/worker";
const source = {
  kind: "lead",
  facts: {
    niche: "salao",
    stage: "new",
    priority: "normal",
    team_size: "1",
    budget_range: "essencial",
    timeline: "now",
    decision_role: "owner",
    challenge: "Preciso organizar os atendimentos",
    next_action: null,
    next_contact_at: null,
  },
  task: null,
};
const catalog = [{ name: "Essencial", cents: 4990, staff: 1 }];
const output = {
  summary: "Contato interessado em organizar a agenda de atendimentos.",
  next_action: "Perguntar quantos profissionais usam a agenda",
  priority: "normal",
  suggested_reply: "Olá! Como você organiza os horários atualmente?",
};
const generation = {
  output,
  model: "google/gemini-3.5-flash-lite",
  input_tokens: 120,
  output_tokens: 90,
};
const job = "00110011-0011-4011-8011-001100110011";
const claim = {
  job: {
    id: job,
    source_type: "lead",
    source_id: job,
    source_label: "QA AI",
    updated_at: "2026-10-22T00:00:00Z",
  },
  claim_token: "fixture-claim-token-long-enough",
  snapshot: source,
};
const secret = "fixture-ai-worker-secret-long-enough";

test("AI context rejects injected identifiers, unknown fields, oversized data and missing real catalog", () => {
  assert.throws(() =>
    buildAiPrompt(
      {
        ...source,
        facts: { ...source.facts, email: "fixture@example.invalid" },
      },
      catalog,
    ),
  );
  assert.throws(() =>
    buildAiPrompt(
      { ...source, facts: { ...source.facts, challenge: "x".repeat(6000) } },
      catalog,
    ),
  );
  assert.throws(() => buildAiPrompt(source, []));
  const p = buildAiPrompt(source, catalog);
  assert.ok(p.prompt.includes('"cents":4990'));
  assert.ok(p.system.includes("não confiáveis"));
  assert.ok(p.system.includes("NÃO estão implementados"));
  assert.ok(!p.prompt.includes(job));
});
test("AI free text removes obvious credentials and contacts without claiming anonymization", () => {
  const value = redactAiText(
    "E-mail fixture@example.invalid tel (11) 99999-1234 cpf 123.456.789-09 senha: segredoTeste https://example.invalid/?token=secret Bearer abcdefghijklmnopqrstuvwxyz",
  );
  for (const original of [
    "fixture@example.invalid",
    "99999-1234",
    "123.456.789-09",
    "segredoTeste",
    "https://",
    "abcdefghijklmnopqrstuvwxyz",
  ])
    assert.ok(!value.includes(original));
  assert.ok(value.includes("removido"));
});
test("AI output accepts only reviewable text and rejects invented tool actions or IDs", () => {
  assert.ok(aiOutputSchema.safeParse(output).success);
  assert.ok(
    !aiOutputSchema.safeParse({ ...output, send_message: true }).success,
  );
  assert.ok(!aiOutputSchema.safeParse({ ...output, lead_id: job }).success);
  assert.ok(!aiOutputSchema.safeParse({ ...output, summary: "" }).success);
  assert.ok(
    !aiOutputSchema.safeParse({ ...output, suggested_reply: "x".repeat(2001) })
      .success,
  );
});
test("AI errors expose only safe categories including verification, budget and ambiguous timeouts", () => {
  assert.equal(
    classifyAiFailure({
      statusCode: 403,
      responseBody: '{"error":{"type":"customer_verification_required"}}',
    }),
    "verification_required",
  );
  assert.equal(
    classifyAiFailure({ cause: { statusCode: 402, message: "SECRET" } }),
    "quota_exceeded",
  );
  assert.equal(classifyAiFailure({ statusCode: 401 }), "provider_unavailable");
  assert.equal(
    classifyAiFailure({ name: "TimeoutError", message: "private" }),
    "worker_interrupted",
  );
  assert.equal(classifyAiFailure(new Error("private")), "provider_failed");
});

function fixture(
  options: { failure?: boolean; stale?: boolean; malformed?: boolean } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let claims = 0;
  let generations = 0;
  const rpc: AiRpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "platform_ai_enqueue")
      return { data: { enqueued: 0 }, error: null };
    if (name === "platform_ai_claim")
      return { data: claims++ === 0 ? claim : null, error: null };
    if (name === "platform_ai_finish")
      return { data: !options.stale, error: null };
    return { data: null, error: null };
  };
  const generate = async () => {
    generations++;
    if (options.failure)
      throw {
        statusCode: 403,
        responseBody:
          '{"error":{"type":"customer_verification_required","detail":"DO_NOT_STORE"}}',
      };
    return options.malformed
      ? { ...generation, output: { ...output, send: true } }
      : generation;
  };
  return { rpc, generate, calls, generations: () => generations };
}
test("AI worker claims once, stores verified draft and usage, and reports actual execution", async () => {
  const f = fixture();
  const result = await runAiBatch({ ...f, secret, trigger: "manual" });
  assert.equal(f.generations(), 1);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  const finish = f.calls.find((x) => x.name === "platform_ai_finish")!;
  assert.deepEqual(finish.args.p_result, generation);
  assert.equal(finish.args.p_claim_token, claim.claim_token);
  assert.equal(f.calls.at(-1)?.name, "platform_ai_worker_report");
  assert.ok(
    f.calls.every(
      (x) => !x.name.includes("review") && !x.name.includes("send"),
    ),
  );
});
test("AI worker persists provider verification failure, stops and never stores a simulated answer", async () => {
  const f = fixture({ failure: true });
  const result = await runAiBatch({ ...f, secret, trigger: "scheduled" });
  assert.equal(f.generations(), 1);
  assert.equal(result.failed, 1);
  assert.equal(result.error, "verification_required");
  const finish = f.calls.find((x) => x.name === "platform_ai_finish")!;
  assert.equal(finish.args.p_result, null);
  assert.equal(finish.args.p_error_code, "verification_required");
  assert.ok(!JSON.stringify(f.calls).includes("DO_NOT_STORE"));
  assert.equal(f.calls.filter((x) => x.name === "platform_ai_claim").length, 1);
});
test("AI worker refuses malformed outputs and treats stale result as unapplied", async () => {
  const malformed = fixture({ malformed: true });
  assert.equal(
    (await runAiBatch({ ...malformed, secret, trigger: "manual" })).error,
    "invalid_output",
  );
  const stale = fixture({ stale: true });
  assert.equal(
    (await runAiBatch({ ...stale, secret, trigger: "manual" })).error,
    "worker_interrupted",
  );
});
test("AI worker fails closed on claim/database errors and rejects unbounded batches", async () => {
  let generated = false;
  const rpc: AiRpc = async (name) =>
    name === "platform_ai_enqueue"
      ? { data: { enqueued: 0 }, error: null }
      : { data: claim, error: true };
  await assert.rejects(
    runAiBatch({
      rpc,
      secret,
      trigger: "manual",
      generate: async () => {
        generated = true;
        return generation;
      },
    }),
    /AI_BATCH_FAILED/,
  );
  assert.equal(generated, false);
  await assert.rejects(
    runAiBatch({
      rpc,
      secret,
      trigger: "manual",
      batch: 4,
      generate: async () => generation,
    }),
    /AI_WORKER_CONFIGURATION/,
  );
});
