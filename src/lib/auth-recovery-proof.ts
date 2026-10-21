import { createHmac, timingSafeEqual } from "node:crypto";
import { RECOVERY_WINDOW_SECONDS } from "./auth-flow";

type SessionIdentity = { userId: string; sessionId: string };
const purpose = "web-fidelize:password-recovery:v1:";

export function validRecoverySecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export function createRecoveryProof(
  identity: SessionIdentity,
  secret: string,
  now = Date.now(),
): string {
  if (!validRecoverySecret(secret))
    throw new Error("Recovery proof is not configured");
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: identity.userId,
      sid: identity.sessionId,
      iat: issuedAt,
      exp: issuedAt + RECOVERY_WINDOW_SECONDS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(purpose + payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

export function verifyRecoveryProof(
  proof: unknown,
  identity: SessionIdentity,
  secret: unknown,
  now = Date.now(),
): boolean {
  if (
    !validRecoverySecret(secret) ||
    typeof proof !== "string" ||
    proof.length > 1024
  )
    return false;
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(proof);
  if (!match) return false;
  const [, payload, signature] = match;
  const expected = createHmac("sha256", secret)
    .update(purpose + payload)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return false;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const seconds = Math.floor(now / 1000);
    return (
      value.sub === identity.userId &&
      value.sid === identity.sessionId &&
      Number.isInteger(value.iat) &&
      Number.isInteger(value.exp) &&
      value.exp === value.iat + RECOVERY_WINDOW_SECONDS &&
      value.iat <= seconds + 60 &&
      value.exp > seconds
    );
  } catch {
    return false;
  }
}
