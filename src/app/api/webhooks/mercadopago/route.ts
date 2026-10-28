import { verifyMercadoPagoWebhook } from "@/lib/billing/mercado-pago";
import {
  billingGateway,
  billingReady,
  billingWorkflow,
} from "@/lib/billing/service";
import { parseBillingWebhook, readBillingBody } from "@/lib/billing/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!billingReady())
    return Response.json({ error: "Indisponível." }, { status: 503, headers });
  const query = new URL(request.url).searchParams;
  if (!verifyMercadoPagoWebhook(request.headers, query))
    return Response.json(
      { error: "Assinatura inválida." },
      { status: 401, headers },
    );
  let event: ReturnType<typeof parseBillingWebhook>;
  try {
    event = parseBillingWebhook(
      await readBillingBody(request),
      query,
      request.headers.get("x-request-id"),
    );
  } catch {
    return Response.json(
      { error: "Evento inválido." },
      { status: 400, headers },
    );
  }
  try {
    const gateway = billingGateway();
    const saved = await gateway("record_event", {
      event_key: event.eventKey,
      event_type: event.topic,
      resource_id: event.resourceId,
    });
    if (
      saved &&
      typeof saved === "object" &&
      "processed" in saved &&
      saved.processed === true
    )
      return Response.json({ received: true }, { headers });
    await billingWorkflow(gateway).event(event.topic, event.resourceId);
    await gateway("event_done", { event_key: event.eventKey });
    return Response.json({ received: true }, { headers });
  } catch {
    // Retain the minimal durable event for recovery and request provider retry.
    // Neither credentials, payer data nor provider bodies enter logs/responses.
    return Response.json(
      { error: "Confirmação pendente. Tente novamente." },
      { status: 503, headers },
    );
  }
}
