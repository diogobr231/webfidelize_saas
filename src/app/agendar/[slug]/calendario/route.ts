import {
  bookingCalendar,
  bookingReceiptSchema,
  readDetailedReceipt,
} from "@/lib/booking-receipt";
import { publicDatabase } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  const token = new URL(request.url).searchParams.get("recibo") || "";
  const claims = secret ? readDetailedReceipt(token, slug, secret) : null;
  if (!claims || !secret)
    return new Response("Reserva não encontrada.", { status: 404 });
  const result = await publicDatabase().rpc("public_booking_receipt", {
    slug,
    request_id: claims.request_id,
    gateway_secret: secret,
  });
  const receipt = bookingReceiptSchema.safeParse(result.data);
  if (
    result.error ||
    !receipt.success ||
    receipt.data.id !== claims.receipt.id
  ) {
    return new Response("Não foi possível consultar a reserva.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(bookingCalendar(receipt.data), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="agendamento.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
