import {
  equalSecret,
  parseWebhookEvents,
  readBoundedBody,
  verifyWhatsAppSignature,
} from "@/lib/whatsapp/core";
import {
  whatsappConnections,
  whatsappGatewaySecret,
  whatsappRpc,
} from "@/lib/whatsapp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const challenge = q.get("hub.challenge");
  if (
    q.get("hub.mode") !== "subscribe" ||
    !equalSecret(
      q.get("hub.verify_token"),
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    ) ||
    !challenge ||
    !/^\d{1,100}$/.test(challenge)
  )
    return new Response("Não autorizado.", { status: 403, headers });
  return new Response(challenge, {
    headers: { ...headers, "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request) {
  let body: Uint8Array;
  try {
    body = await readBoundedBody(request);
  } catch {
    return Response.json(
      { error: "Payload inválido." },
      { status: 413, headers },
    );
  }
  if (
    !verifyWhatsAppSignature(
      body,
      request.headers.get("x-hub-signature-256"),
      process.env.WHATSAPP_APP_SECRET,
    )
  )
    return Response.json(
      { error: "Assinatura inválida." },
      { status: 403, headers },
    );
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
  } catch {
    return Response.json(
      { error: "Payload inválido." },
      { status: 400, headers },
    );
  }
  try {
    const events = parseWebhookEvents(payload, whatsappConnections());
    const secret = whatsappGatewaySecret();
    const rpc = whatsappRpc();
    for (const event of events) {
      const result =
        event.type === "delivery"
          ? await rpc("whatsapp_delivery_event", {
              p_secret: secret,
              p_company: event.companyId,
              p_job: event.jobId,
              p_message_id: event.messageId,
              p_status: event.status,
              p_error: event.error,
            })
          : await rpc("whatsapp_opt_out", {
              p_secret: secret,
              p_company: event.companyId,
              p_phone: event.phone,
            });
      if (result.error) throw new Error("DATABASE_UNAVAILABLE");
      if (event.type === "delivery" && result.data === false) {
        const staffResult = await rpc("whatsapp_staff_delivery_event", {
          p_secret: secret,
          p_company: event.companyId,
          p_job: event.jobId,
          p_message_id: event.messageId,
          p_status: event.status,
          p_error: event.error,
        });
        if (staffResult.error) throw new Error("DATABASE_UNAVAILABLE");
      }
    }
    return Response.json({ received: true }, { headers });
  } catch {
    // Non-2xx lets Meta retry. Database events are idempotent and monotonic.
    return Response.json(
      { error: "Processamento indisponível." },
      { status: 503, headers },
    );
  }
}
