import "server-only";
import nodemailer from "nodemailer";
import type { TeamInvitationIssue } from "./team";
import {
  deliverInvitation,
  invitationMailConfig,
  type InvitationDelivery,
} from "./team-mail-content";

export function invitationEmailEnabled() {
  return invitationMailConfig(process.env) !== null;
}

/** Call only after the authenticated, rate-limited invitation RPC has succeeded. */
export async function sendTeamInvitation(
  issue: TeamInvitationIssue,
): Promise<InvitationDelivery> {
  const config = invitationMailConfig(process.env);
  if (!config) return "unavailable";
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  try {
    return await deliverInvitation(issue, config, (message) =>
      transporter.sendMail(message),
    );
  } finally {
    transporter.close();
  }
}
