import "server-only";
import { generateText, Output } from "ai";
import { getVercelOidcTokenSync } from "@vercel/oidc";
import { AI_MODEL, aiOutputSchema, buildAiPrompt, type AiPlan } from "./core";

export function aiProviderConfigured() {
  if (process.env.AI_GATEWAY_API_KEY) return true;
  try {
    // Vercel Functions carry OIDC in request context, not an environment variable.
    // Resolve it per request, exactly as the gateway SDK does; never expose the token.
    return Boolean(getVercelOidcTokenSync());
  } catch {
    return false;
  }
}
export async function generateAiAnalysis(snapshot: unknown, plans: AiPlan[]) {
  if (!aiProviderConfigured()) throw new Error("AI_NOT_CONFIGURED");
  const prompt = buildAiPrompt(snapshot, plans);
  const result = await generateText({
    model: AI_MODEL,
    ...prompt,
    output: Output.object({ schema: aiOutputSchema }),
    maxOutputTokens: 1800,
    reasoning: "low",
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(15000),
    providerOptions: { gateway: { only: ["vertex"] } },
    experimental_telemetry: { isEnabled: false },
  });
  const output = aiOutputSchema.parse(result.output);
  const input = result.usage.inputTokens;
  const completion = result.usage.outputTokens;
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(completion) ||
    input! < 0 ||
    completion! < 0
  )
    throw new Error("AI_INVALID_OUTPUT");
  return {
    output,
    model: AI_MODEL,
    input_tokens: input!,
    output_tokens: completion!,
  };
}
