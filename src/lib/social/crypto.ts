import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
function key(secret: string) {
  const bytes = Buffer.from(secret, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== secret)
    throw new Error("SOCIAL_KEY_CONFIGURATION");
  return bytes;
}
export function sealSocialToken(
  token: string,
  context: string,
  secret: string,
): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function openSocialToken(
  value: string,
  context: string,
  secret: string,
): string {
  const [version, iv, tag, payload, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !payload || extra)
    throw new Error("SOCIAL_TOKEN_INVALID");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
const stateSchema = z
  .object({
    company: z.uuid(),
    user: z.uuid(),
    network: z.enum(["instagram", "facebook"]),
    page: z.string().regex(/^\d{5,30}$/),
    expires: z.number().int(),
    nonce: z.string().length(32),
  })
  .strict();
export type SocialState = z.infer<typeof stateSchema>;
export function makeSocialState(
  input: Omit<SocialState, "expires" | "nonce">,
  secret: string,
  now = Date.now(),
) {
  const body = Buffer.from(
    JSON.stringify(
      stateSchema.parse({
        ...input,
        expires: now + 600000,
        nonce: randomBytes(24).toString("base64url"),
      }),
    ),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", key(secret)).update(body).digest("base64url")}`;
}
export function readSocialState(
  state: string,
  cookie: string,
  user: string,
  secret: string,
  now = Date.now(),
): SocialState | null {
  try {
    if (state.length > 2000 || state !== cookie) return null;
    const [body, signature, extra] = state.split(".");
    if (!body || !signature || extra) return null;
    const expected = createHmac("sha256", key(secret)).update(body).digest();
    const received = Buffer.from(signature, "base64url");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return null;
    const data = stateSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    return data.user === user &&
      data.expires > now &&
      data.expires <= now + 600000
      ? data
      : null;
  } catch {
    return null;
  }
}
