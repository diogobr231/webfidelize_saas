import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const bookingReceiptSchema = z
  .object({
    id: z.uuid(),
    service_name: z.string().min(1).max(120),
    professional_name: z.string().min(1).max(120),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    status: z.enum(["scheduled", "completed", "canceled"]),
  })
  .strict()
  .refine(
    (receipt) =>
      new Date(receipt.ends_at).getTime() >
      new Date(receipt.starts_at).getTime(),
  );

const detailedReceiptSchema = z
  .object({
    version: z.literal(1),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/),
    request_id: z.uuid(),
    receipt: bookingReceiptSchema,
  })
  .strict();

export type BookingReceipt = z.infer<typeof bookingReceiptSchema>;

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
  if (
    typeof proof !== "string" ||
    !z.uuid().safeParse(id).success ||
    !/^[a-f0-9]{64}$/.test(proof)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(proof, "hex"),
    Buffer.from(signReceipt(slug, id, secret), "hex"),
  );
}

export function signDetailedReceipt(
  slug: string,
  requestId: string,
  receipt: BookingReceipt,
  secret: string,
) {
  const payload = detailedReceiptSchema.parse({
    version: 1,
    slug,
    request_id: requestId,
    receipt,
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const proof = createHmac("sha256", secret)
    .update(`booking-details:${encoded}`)
    .digest("hex");
  return `${encoded}.${proof}`;
}

export function readDetailedReceipt(
  token: string,
  slug: string,
  secret: string,
) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const [, encoded, proof] = match;
  const expected = createHmac("sha256", secret)
    .update(`booking-details:${encoded}`)
    .digest("hex");
  if (!timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(expected, "hex")))
    return null;
  try {
    const payload = detailedReceiptSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    return payload.success && payload.data.slug === slug ? payload.data : null;
  } catch {
    return null;
  }
}

function escapeCalendarText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// RFC 5545 limits physical content lines to 75 UTF-8 octets, including the
// continuation space. Iterate code points so accented names remain intact.
function foldCalendarLine(line: string) {
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > 75) {
      parts.push(current);
      current = " ";
    }
    current += character;
  }
  parts.push(current);
  return parts.join("\r\n");
}

export function bookingCalendar(receipt: BookingReceipt, now = new Date()) {
  const data = bookingReceiptSchema.parse(receipt);
  const stamp = (value: string | Date) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Web Fidelize//Agendamento//PT-BR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${data.id}@webfidelize`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(data.starts_at)}`,
    `DTEND:${stamp(data.ends_at)}`,
    `SUMMARY:${escapeCalendarText(data.service_name)}`,
    `DESCRIPTION:${escapeCalendarText(`Profissional: ${data.professional_name}. Para alterar ou cancelar, entre em contato com a empresa.`)}`,
    `STATUS:${data.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldCalendarLine)
    .join("\r\n");
}
