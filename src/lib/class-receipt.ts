import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { classSlugSchema } from "./classes";

/** A capability to read one stored, PII-free receipt; never a claim of success. */
export function signClassReceipt(
  slug: string,
  requestId: string,
  secret: string,
) {
  classSlugSchema.parse(slug);
  z.uuid().parse(requestId);
  const proof = createHmac("sha256", secret)
    .update(`class-receipt:v1:${slug}:${requestId}`)
    .digest("hex");
  return `${requestId}.${proof}`;
}
export function readClassReceipt(
  token: unknown,
  slug: string,
  secret: string,
): string | null {
  if (
    typeof token !== "string" ||
    token.length > 120 ||
    !classSlugSchema.safeParse(slug).success
  )
    return null;
  const parts = token.split(".");
  if (
    parts.length !== 2 ||
    !z.uuid().safeParse(parts[0]).success ||
    !/^[a-f0-9]{64}$/.test(parts[1])
  )
    return null;
  const expected = signClassReceipt(slug, parts[0], secret).split(".")[1];
  return timingSafeEqual(
    Buffer.from(parts[1], "hex"),
    Buffer.from(expected, "hex"),
  )
    ? parts[0]
    : null;
}
