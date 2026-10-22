import { resolveAuthOrigin } from "../auth-flow";

/** Use trusted deployment configuration; never derive security from Host headers. */
export function authCookieOptions(appUrl: unknown, production = false) {
  const origin = resolveAuthOrigin(appUrl, production);
  // next start also serves localhost over HTTP during local verification.
  // Preserve SDK defaults for SameSite, path, HttpOnly and cookie naming.
  return { secure: new URL(origin).protocol === "https:" };
}
