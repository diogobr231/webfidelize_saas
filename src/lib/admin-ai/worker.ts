import { z } from "zod";
import {
  aiOutputSchema,
  aiSnapshotSchema,
  classifyAiFailure,
  type AiErrorCode,
} from "./core";

export type AiRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
const resultSchema = z
  .object({
    output: aiOutputSchema,
    model: z.string().min(1).max(120),
    input_tokens: z.number().int().min(0).max(1_000_000),
    output_tokens: z.number().int().min(0).max(1_000_000),
  })
  .strict();
const claimEnvelope = z.object({
  job: z.object({
    id: z.uuid(),
    source_type: z.enum(["lead", "ticket", "task"]),
    source_id: z.uuid(),
    source_label: z.string(),
    updated_at: z.string(),
  }),
  claim_token: z.string().min(20).max(200),
  snapshot: z.unknown(),
});
export type AiBatchResult = {
  processed: number;
  failed: number;
  enqueued: number;
  error: AiErrorCode | null;
};

/** No provider retry, no outbound messages, no automatic approval. Reservations live in PostgreSQL. */
export async function runAiBatch({
  rpc,
  secret,
  generate,
  trigger,
  batch = 3,
}: {
  rpc: AiRpc;
  secret: string;
  generate: (snapshot: unknown) => Promise<unknown>;
  trigger: "manual" | "scheduled";
  batch?: number;
}): Promise<AiBatchResult> {
  if (secret.length < 32 || !Number.isInteger(batch) || batch < 1 || batch > 3)
    throw new Error("AI_WORKER_CONFIGURATION");
  const outcome: AiBatchResult = {
    processed: 0,
    failed: 0,
    enqueued: 0,
    error: null,
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(name, { p_secret: secret, ...args });
    if (r.error) throw new Error("AI_DATABASE_UNAVAILABLE");
    return r.data;
  };
  try {
    const queued = await call("platform_ai_enqueue", { p_limit: 3 });
    outcome.enqueued = z
      .object({ enqueued: z.number().int().nonnegative().max(50) })
      .parse(queued).enqueued;
    for (let i = 0; i < batch; i++) {
      const raw = await call("platform_ai_claim", {});
      if (raw === null) break;
      const claim = claimEnvelope.parse(raw);
      let result: z.infer<typeof resultSchema> | null = null;
      let error: AiErrorCode | null = null;
      try {
        result = resultSchema.parse(
          await generate(aiSnapshotSchema.parse(claim.snapshot)),
        );
      } catch (cause) {
        error = classifyAiFailure(cause);
      }
      const saved = await call("platform_ai_finish", {
        p_job: claim.job.id,
        p_claim_token: claim.claim_token,
        p_result: result,
        p_error_code: error,
      });
      if (saved !== true || error) {
        outcome.failed++;
        // A rejected receipt may mean changed context, revoked authority or an expired lease.
        // The job carries the precise reason; do not guess it in the execution summary.
        outcome.error = error ?? "worker_interrupted";
      } else outcome.processed++;
      // Stop after any failure: ambiguous timeouts are never retried in this invocation.
      if (outcome.error) break;
    }
    await call("platform_ai_worker_report", {
      p_trigger: trigger,
      p_error_code: outcome.error,
      p_processed: outcome.processed,
      p_failed: outcome.failed,
    });
    return outcome;
  } catch {
    // Do not emit raw RPC/SDK errors, which may contain source data or authorization headers.
    throw new Error("AI_BATCH_FAILED");
  }
}
