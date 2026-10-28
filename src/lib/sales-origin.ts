import { createHmac } from "node:crypto";
import { isIP } from "node:net";

type HeaderReader = { get(name: string): string | null };

function normalizedAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  if (!address || address.length > 45 || address.includes("%")) return null;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6) return null;
  // Normalize equivalent IPv6 spellings and group privacy addresses by /64.
  let expanded = address;
  if (address.includes(".")) {
    const boundary = address.lastIndexOf(":");
    const bytes = address
      .slice(boundary + 1)
      .split(".")
      .map(Number);
    expanded = `${address.slice(0, boundary)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = expanded.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups = (
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left
  ).map((group) => Number.parseInt(group, 16));
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 65535)
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** Server-only consumer. Never return the raw address or include it in logs. */
export function salesOriginHash(
  headers: HeaderReader,
  secret: string,
  isVercel: boolean,
): string | null {
  if (secret.length < 32 || secret.length > 1024) return null;
  // Only trust Vercel's platform header on a Vercel runtime, not a browser's
  // x-forwarded-for or form field. https://vercel.com/docs/headers/request-headers
  const source = isVercel
    ? normalizedAddress(headers.get("x-vercel-forwarded-for") ?? "")
    : "local-untrusted-origin";
  if (source === null) return null;
  return createHmac("sha256", secret)
    .update(`webfidelize:sales-source:v1\0${source}`)
    .digest("hex");
}
