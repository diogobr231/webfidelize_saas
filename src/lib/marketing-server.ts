import "server-only";
import { generateText, Output } from "ai";
import { aiProviderConfigured } from "./admin-ai/provider";
import { AI_MODEL } from "./admin-ai/core";
import {
  buildMarketingAiPrompt,
  marketingAiOutputSchema,
  type MarketingCampaign,
} from "./marketing";
import type { CommercialPlan } from "./commercial";

export { aiProviderConfigured as marketingAiConfigured };

/** The caller reserves one durable attempt before this call; no model tools or retries. */
export async function generateMarketingCopy(
  campaign: MarketingCampaign,
  plans: CommercialPlan[],
) {
  if (!aiProviderConfigured()) throw new Error("AI_NOT_CONFIGURED");
  const result = await generateText({
    model: AI_MODEL,
    ...buildMarketingAiPrompt(campaign, plans),
    output: Output.object({ schema: marketingAiOutputSchema }),
    maxOutputTokens: 2000,
    reasoning: "low",
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(15000),
    providerOptions: { gateway: { only: ["vertex"] } },
    experimental_telemetry: { isEnabled: false },
  });
  const output = marketingAiOutputSchema.parse(result.output);
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  if (
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    inputTokens! < 0 ||
    outputTokens! < 0 ||
    inputTokens! > 1_000_000 ||
    outputTokens! > 1_000_000
  )
    throw new Error("AI_INVALID_OUTPUT");
  return { output, inputTokens: inputTokens!, outputTokens: outputTokens! };
}
