import "server-only";
import { resolveAuthOrigin } from "./auth-flow";

export function getAuthOrigin(): string {
  return resolveAuthOrigin(
    process.env.APP_URL,
    process.env.VERCEL_ENV === "production",
  );
}
