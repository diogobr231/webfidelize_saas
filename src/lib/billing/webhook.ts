import { createHash } from "node:crypto";
import { BillingError, safeProviderId } from "./core";
import type { BillingTopic } from "./workflow";

const topics = new Set<BillingTopic>([
  "payment",
  "subscription_preapproval",
  "subscription_authorized_payment",
]);
/** The signature authenticates the query ID; the body may not substitute it. */
export function parseBillingWebhook(
  body: unknown,
  query: URLSearchParams,
  requestId: string | null,
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !requestId ||
    requestId.length > 200 ||
    query.getAll("data.id").length !== 1
  )
    throw new BillingError("invalid_input");
  const event = body as Record<string, unknown>;
  if (
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  )
    throw new BillingError("invalid_input");
  const resourceId = safeProviderId((event.data as Record<string, unknown>).id);
  if (resourceId !== query.get("data.id") || resourceId.length > 100)
    throw new BillingError("mismatch");
  if (typeof event.type !== "string" || !topics.has(event.type as BillingTopic))
    throw new BillingError("invalid_input");
  if (
    query.getAll("type").length > 1 ||
    (query.has("type") && query.get("type") !== event.type)
  )
    throw new BillingError("mismatch");
  // Different updates for the same resource must be processed independently.
  const eventKey = createHash("sha256")
    .update(`${event.type}:${resourceId}:${requestId}`)
    .digest("hex");
  return { eventKey, topic: event.type as BillingTopic, resourceId };
}
export async function readBillingBody(request: Request): Promise<unknown> {
  const limit = 32768;
  if (
    Number(request.headers.get("content-length") || 0) > limit ||
    !request.body
  )
    throw new BillingError("invalid_input");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BillingError("invalid_input");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    reader.releaseLock();
  }
}
