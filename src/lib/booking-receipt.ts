import { createHmac, timingSafeEqual } from "node:crypto";
export function signReceipt(slug: string, id: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`booking-receipt:${slug}:${id}`)
    .digest("hex");
}
export function validReceipt(
  slug: string,
  id: string,
  proof: string,
  secret: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(proof))
    return false;
  return timingSafeEqual(
    Buffer.from(proof, "hex"),
    Buffer.from(signReceipt(slug, id, secret), "hex"),
  );
}
