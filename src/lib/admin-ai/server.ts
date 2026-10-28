import "server-only";
import { publicDatabase } from "@/lib/supabase/public";
import { commercialPlans } from "@/lib/commercial";
import { generateAiAnalysis, aiProviderConfigured } from "./provider";
import { runAiBatch, type AiRpc } from "./worker";

export function aiServerConfiguration() {
  return {
    providerConfigured: aiProviderConfigured(),
    workerConfigured: (process.env.AI_WORKER_SECRET?.length ?? 0) >= 32,
  };
}
export async function processAdminAi(trigger: "manual" | "scheduled") {
  const secret = process.env.AI_WORKER_SECRET;
  if (!secret || secret.length < 32) throw new Error("AI_WORKER_CONFIGURATION");
  // Do not reserve an attempt when no provider credential is available at all.
  if (!aiProviderConfigured()) throw new Error("AI_PROVIDER_CONFIGURATION");
  const db = publicDatabase();
  const rpc: AiRpc = async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    return { data, error: error ? true : null };
  };
  // Read the authoritative public catalog; do not replace unavailable prices with estimates.
  const plans = await commercialPlans();
  if (!plans) throw new Error("AI_CATALOG_UNAVAILABLE");
  return runAiBatch({
    rpc,
    secret,
    trigger,
    generate: (snapshot) => generateAiAnalysis(snapshot, plans),
  });
}
