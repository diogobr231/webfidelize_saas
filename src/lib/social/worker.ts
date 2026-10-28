import { z } from "zod";
import { openSocialToken } from "./crypto";
import { publishSocialPhoto } from "./meta";
const jobSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  attempt_id: z.uuid(),
  network: z.enum(["instagram", "facebook"]),
  external_id: z.string().regex(/^\d{5,30}$/),
  asset_path: z.string(),
  encrypted_token: z.string(),
  caption: z.string(),
  alt_text: z.string(),
});
export type SocialRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
/** One attempt, no retry on unknown outcome. Transport injected in isolated tests. */
export async function runSocialJob(input: {
  rpc: SocialRpc;
  secret: string | null;
  version: string;
  encryption: string;
  assetUrl: (path: string) => Promise<string>;
  publish?: typeof publishSocialPhoto;
}) {
  const claim = await input.rpc("social_claim", { p_secret: input.secret });
  if (claim.error) throw new Error("SOCIAL_CLAIM_FAILED");
  if (!claim.data) return { processed: 0, status: "idle" };
  const job = jobSchema.parse(claim.data);
  // Never sign a different company's object, even if a corrupt backend returns it.
  if (job.asset_path !== `${job.company_id}/${job.id}.jpg`)
    throw new Error("SOCIAL_ASSET_MISMATCH");
  let status: "published" | "failed" | "unknown" = "failed",
    providerId: string | null = null;
  try {
    const token = openSocialToken(
      job.encrypted_token,
      `${job.company_id}:${job.network}:${job.external_id}`,
      input.encryption,
    );
    const imageUrl = await input.assetUrl(job.asset_path);
    status = "unknown"; // From here a timeout may hide an external side effect.
    providerId = await (input.publish ?? publishSocialPhoto)({
      version: input.version,
      network: job.network,
      externalId: job.external_id,
      token,
      imageUrl,
      caption: job.caption,
      altText: job.alt_text,
    });
    status = "published";
  } catch {
    /* Provider data and credentials are never logged or returned to UI. */
  }
  const finish = await input.rpc("social_finish", {
    p_secret: input.secret,
    p_id: job.id,
    p_attempt: job.attempt_id,
    p_status: status,
    p_provider_id: providerId,
  });
  if (finish.error) throw new Error("SOCIAL_OUTCOME_UNACKNOWLEDGED");
  return { processed: 1, status };
}
