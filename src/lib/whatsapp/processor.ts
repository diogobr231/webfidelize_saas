import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  reminderJobSchema,
  tokenHash,
  type ReminderJob,
  type WhatsAppConnection,
} from "./core";

export type ReminderRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
export type SendResult =
  | { status: "accepted"; messageId: string }
  | { status: "failed" | "unknown"; error: string };

/** Dispatch at most five messages per invocation. Claims and quotas live in Postgres. */
export async function processReminders(input: {
  secret: string;
  connections: WhatsAppConnection[];
  rpc: ReminderRpc;
  batch?: number;
  send: (
    connection: WhatsAppConnection,
    job: ReminderJob,
    token: string,
  ) => Promise<SendResult>;
}) {
  const counts = { claimed: 0, accepted: 0, failed: 0, unknown: 0, skipped: 0 };
  const claimed = await input.rpc("claim_whatsapp_reminders", {
    p_secret: input.secret,
    p_companies: input.connections.map((item) => item.companyId),
    p_batch: z
      .number()
      .int()
      .min(1)
      .max(5)
      .parse(input.batch ?? 5),
  });
  if (claimed.error) throw new Error("WHATSAPP_DATABASE_UNAVAILABLE");
  const jobs = z.array(reminderJobSchema).max(5).safeParse(claimed.data);
  if (!jobs.success) throw new Error("WHATSAPP_DATABASE_RESPONSE_INVALID");
  counts.claimed = jobs.data.length;
  for (const job of jobs.data) {
    const connection = input.connections.find(
      (item) => item.companyId === job.company_id,
    );
    if (!connection) {
      counts.skipped++;
      continue;
    }
    const token = randomBytes(32).toString("hex");
    const prepared = await input.rpc("prepare_whatsapp_reminder", {
      p_secret: input.secret,
      p_job: job.job_id,
      p_token_hash: tokenHash(token),
    });
    if (prepared.error) throw new Error("WHATSAPP_DATABASE_UNAVAILABLE");
    if (prepared.data === null) {
      counts.skipped++;
      continue;
    }
    const current = reminderJobSchema.safeParse(prepared.data);
    if (
      !current.success ||
      current.data.job_id !== job.job_id ||
      current.data.company_id !== connection.companyId
    )
      throw new Error("WHATSAPP_DATABASE_RESPONSE_INVALID");
    let result: SendResult;
    try {
      result = await input.send(connection, current.data, token);
    } catch {
      result = { status: "unknown", error: "network_unknown" };
    }
    // If persisting this result fails, never re-send. A signed webhook can
    // reconcile using biz_opaque_callback_data even if the HTTP response was lost.
    const finished = await input.rpc("finish_whatsapp_reminder", {
      p_secret: input.secret,
      p_job: job.job_id,
      p_status: result.status,
      p_message_id: result.status === "accepted" ? result.messageId : null,
      p_error: result.status === "accepted" ? null : result.error,
    });
    if (finished.error) throw new Error("WHATSAPP_DATABASE_UNAVAILABLE");
    counts[result.status]++;
  }
  return counts;
}
