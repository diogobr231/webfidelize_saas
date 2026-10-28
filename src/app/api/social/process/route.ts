import { equalSecret } from "@/lib/whatsapp/core";
import { processSocialSchedule } from "@/lib/social/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const headers = { "Cache-Control": "no-store" };
  if (
    !secret ||
    secret.length < 32 ||
    !equalSecret(request.headers.get("authorization"), `Bearer ${secret}`)
  )
    return Response.json(
      { error: "Não autorizado." },
      { status: 401, headers },
    );
  try {
    return Response.json(await processSocialSchedule(), { headers });
  } catch {
    return Response.json(
      { error: "Publicação desativada ou processamento não confirmado." },
      { status: 503, headers },
    );
  }
}
