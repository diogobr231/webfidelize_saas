import { z } from "zod";
import type { WhatsAppConnection } from "./core";
import type { ReminderRpc, SendResult } from "./processor";
import { staffJobSchema, staffTemplateName, type StaffJob } from "./staff-core";

export async function processStaffNotifications(input: {
  secret: string;
  connections: WhatsAppConnection[];
  rpc: ReminderRpc;
  batch?: number;
  send: (connection: WhatsAppConnection, job: StaffJob) => Promise<SendResult>;
}) {
  const counts = { claimed: 0, accepted: 0, failed: 0, unknown: 0, skipped: 0 };
  const configured = input.connections.filter(
    (item) =>
      item.staffDailyTemplateName && item.staffNewAppointmentTemplateName,
  );
  if (!configured.length) return counts;
  const claimed = await input.rpc("claim_whatsapp_staff_notifications", {
    p_secret: input.secret,
    p_companies: configured.map((item) => item.companyId),
    p_batch: z
      .number()
      .int()
      .min(1)
      .max(5)
      .parse(input.batch ?? 2),
  });
  if (claimed.error) throw new Error("WHATSAPP_DATABASE_UNAVAILABLE");
  const jobs = z.array(staffJobSchema).max(5).safeParse(claimed.data);
  if (!jobs.success) throw new Error("WHATSAPP_DATABASE_RESPONSE_INVALID");
  counts.claimed = jobs.data.length;
  for (const job of jobs.data) {
    const connection = configured.find(
      (item) => item.companyId === job.company_id,
    );
    // A missing mode template must not reserve quota or send using the customer's template.
    if (!connection || !staffTemplateName(connection, job.kind)) {
      counts.skipped++;
      continue;
    }
    const prepared = await input.rpc("prepare_whatsapp_staff_notification", {
      p_secret: input.secret,
      p_job: job.job_id,
    });
    if (prepared.error) throw new Error("WHATSAPP_DATABASE_UNAVAILABLE");
    if (prepared.data === null) {
      counts.skipped++;
      continue;
    }
    const current = staffJobSchema.safeParse(prepared.data);
    if (
      !current.success ||
      current.data.job_id !== job.job_id ||
      current.data.company_id !== connection.companyId ||
      current.data.kind !== job.kind ||
      current.data.professional_id !== job.professional_id
    )
      throw new Error("WHATSAPP_DATABASE_RESPONSE_INVALID");
    let result: SendResult;
    try {
      result = await input.send(connection, current.data);
    } catch {
      result = { status: "unknown", error: "network_unknown" };
    }
    const finished = await input.rpc("finish_whatsapp_staff_notification", {
      p_secret: input.secret,
      p_job: job.job_id,
      p_status: result.status,
      p_message_id: result.status === "accepted" ? result.messageId : null,
      p_error: result.status === "accepted" ? null : result.error,
    });
    if (finished.error) throw new Error("WHATSAPP_DATABASE_UNAVAILABLE");
    // Stop without resending when the backend cannot confirm reconciliation.
    if (finished.data !== true)
      throw new Error("WHATSAPP_DATABASE_RESPONSE_INVALID");
    counts[result.status]++;
  }
  return counts;
}
