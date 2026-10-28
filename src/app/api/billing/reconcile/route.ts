import { equalSecret } from "@/lib/whatsapp/core";
import {
  billingGateway,
  billingReady,
  billingWorkflow,
} from "@/lib/billing/service";
import { pendingSchema, validated } from "@/lib/billing/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

async function reconcile(request: Request) {
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
  if (!billingReady()) return Response.json({ enabled: false }, { headers });
  try {
    const gateway = billingGateway(),
      workflow = billingWorkflow(gateway);
    const batch = validated(
      pendingSchema,
      await gateway("list_pending", { limit: 3 }),
    );
    let processed = 0,
      failed = 0;
    // Independent resources use bounded parallelism; database writes serialize
    // per company and payment. Expiration never depends on this scheduled job.
    const jobs: (() => Promise<void>)[] = batch.events
      .slice(0, 3)
      .map((event) => async () => {
        await workflow.event(event.event_type, event.resource_id);
        await gateway("event_done", { event_key: event.event_key });
      });
    const ids = new Set<string>();
    for (const checkout of batch.checkouts)
      if (checkout.environment === process.env.BILLING_MODE)
        ids.add(checkout.id);
    for (const subscription of batch.subscriptions)
      if (subscription.environment === process.env.BILLING_MODE)
        ids.add(subscription.external_reference);
    for (const id of [...ids].slice(0, 3))
      jobs.push(() => workflow.checkout(id));
    for (const payment of batch.payments.slice(0, 3))
      if (payment.environment === process.env.BILLING_MODE)
        jobs.push(() => workflow.event("payment", payment.provider_id));
    for (let start = 0; start < jobs.length; start += 3) {
      const results = await Promise.allSettled(
        jobs.slice(start, start + 3).map((job) => job()),
      );
      for (const result of results)
        result.status === "fulfilled" ? processed++ : failed++;
    }
    return Response.json(
      { processed, failed },
      { headers, status: failed ? 503 : 200 },
    );
  } catch {
    return Response.json(
      { error: "Reconciliação pendente." },
      { status: 503, headers },
    );
  }
}
export const GET = reconcile;
export const POST = reconcile;
