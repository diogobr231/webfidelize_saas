import { equalSecret } from "@/lib/whatsapp/core";
import { processAdminAi } from "@/lib/admin-ai/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
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
    const result = await processAdminAi("scheduled");
    return Response.json(result, { status: result.error ? 503 : 200, headers });
  } catch {
    return Response.json(
      { error: "Processamento indisponível." },
      { status: 503, headers },
    );
  }
}
