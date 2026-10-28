import "server-only";
import { createClient } from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import { aiProviderConfigured } from "@/lib/admin-ai/provider";
import { AI_MODEL } from "@/lib/admin-ai/core";
import { captionOutputSchema, captionPrompt } from "./core";
import { metaConfig } from "./meta";
import { runSocialJob } from "./worker";

export function socialConfiguration() {
  const encryption = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encryption, "base64");
  const oauth = Boolean(
    metaConfig(process.env) &&
      key.length === 32 &&
      key.toString("base64") === encryption,
  );
  return {
    oauth,
    ai: aiProviderConfigured(),
    publishing: oauth && process.env.SOCIAL_PUBLISHING_ENABLED === "true",
    worker:
      (process.env.SOCIAL_WORKER_SECRET?.length ?? 0) >= 32 &&
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}
export async function socialCaption(
  company: string,
  brief: string,
  image: Uint8Array | null,
) {
  if (!aiProviderConfigured()) throw new Error("SOCIAL_AI_CONFIGURATION");
  const { system, prompt } = captionPrompt(company, brief);
  const result = await generateText({
    model: AI_MODEL,
    system: image
      ? system.replace(
          "você NÃO recebeu a foto",
          "use a foto somente como referência visual, sem identificar pessoas nem inferir dados sensíveis",
        )
      : system,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...(image
            ? [{ type: "image" as const, image, mediaType: "image/jpeg" }]
            : []),
        ],
      },
    ],
    output: Output.object({ schema: captionOutputSchema }),
    maxOutputTokens: 1400,
    reasoning: "low",
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(25000),
    providerOptions: { gateway: { only: ["vertex"] } },
    experimental_telemetry: { isEnabled: false },
  });
  const output = captionOutputSchema.parse(result.output);
  return `${output.caption}\n\n${output.hashtags.join(" ")}`.trim();
}
export async function processSocialSchedule() {
  const config = socialConfiguration(),
    meta = metaConfig(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    storageKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    secret = process.env.SOCIAL_WORKER_SECRET,
    encryption = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (
    !config.publishing ||
    !config.worker ||
    !meta ||
    !url ||
    !publicKey ||
    !storageKey ||
    !secret ||
    !encryption
  )
    throw new Error("SOCIAL_DISABLED");
  const db = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Dedicated server-only storage signer; never imported by client components.
  const storage = createClient(url, storageKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return runSocialJob({
    rpc: async (name, args) => {
      const r = await db.rpc(name, args);
      return { data: r.data, error: r.error ? true : null };
    },
    secret,
    version: meta.version,
    encryption,
    assetUrl: async (path) => {
      const { data, error } = await storage.storage
        .from("social-assets")
        .createSignedUrl(path, 300);
      if (error || !data) throw new Error("SOCIAL_ASSET_UNAVAILABLE");
      return data.signedUrl;
    },
  });
}
