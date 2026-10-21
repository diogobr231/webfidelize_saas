import { equalSecret } from "@/lib/whatsapp/core";
import { processReminders } from "@/lib/whatsapp/processor";
import {
  getWhatsAppConnectionStatus,
  sendWhatsAppReminder,
  whatsappConnections,
  whatsappGatewaySecret,
  whatsappRpc,
} from "@/lib/whatsapp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

async function handleProcess(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    process.env.CRON_SECRET.length < 32 ||
    !equalSecret(
      request.headers.get("authorization"),
      `Bearer ${process.env.CRON_SECRET}`,
    )
  )
    return Response.json(
      { error: "Não autorizado." },
      { status: 401, headers },
    );
  try {
    const connections = whatsappConnections().filter(
      (item) => getWhatsAppConnectionStatus(item.companyId).configured,
    );
    if (!connections.length)
      return Response.json(
        {
          error: "Envio indisponível. Verifique a configuração da integração.",
        },
        { status: 503, headers },
      );
    const result = await processReminders({
      secret: whatsappGatewaySecret(),
      connections,
      rpc: whatsappRpc(),
      send: sendWhatsAppReminder,
    });
    return Response.json(result, { headers });
  } catch {
    // Provider errors can include recipients and credentials. Keep logs/responses generic.
    return Response.json(
      { error: "Não foi possível concluir o processamento." },
      { status: 503, headers },
    );
  }
}

export const GET = handleProcess;
export const POST = handleProcess;
