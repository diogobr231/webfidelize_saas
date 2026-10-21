import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import {
  deliverInvitation,
  invitationMailConfig,
  invitationMailMessage,
} from "../src/lib/team-mail-content";
import type { TeamInvitationIssue } from "../src/lib/team";

const env = {
  APP_URL: "https://app.example.com",
  TEAM_SMTP_HOST: "smtp.example.com",
  TEAM_SMTP_PORT: "465",
  TEAM_SMTP_USER: "test-user",
  TEAM_SMTP_PASSWORD: "synthetic-test-secret",
  TEAM_SMTP_FROM: "equipe@example.com",
};
const config = invitationMailConfig(env)!;
const issue: TeamInvitationIssue = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  issue_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  token: "a".repeat(64),
  email: "recipient@example.com",
  role: "EMPLOYEE",
  company_name: '<script>alert("x")</script> & Empresa\r\nBcc: outra',
  expires_at: "2026-12-01T12:00:00Z",
};

test("SMTP is disabled for incomplete credentials or insecure origin/transport", () => {
  assert.equal(invitationMailConfig({}), null);
  for (const override of [
    { TEAM_SMTP_PASSWORD: "" },
    { TEAM_SMTP_PORT: "25" },
    { TEAM_SMTP_FROM: "a@example.com\r\nBcc: b@example.com" },
    { APP_URL: "http://app.example.com" },
    { APP_URL: "http://localhost:3000" },
    { APP_URL: "https://app.example.com/path" },
  ])
    assert.equal(invitationMailConfig({ ...env, ...override }), null);
  assert.equal(config.port, 465);
  assert.equal(
    invitationMailConfig({ ...env, TEAM_SMTP_PORT: "587" })?.port,
    587,
  );
});
test("invitation email escapes untrusted names and uses only canonical recipient and URL", () => {
  const message = invitationMailMessage(issue, config);
  assert.equal(message.to, issue.email);
  assert.ok(message.text.includes(`${env.APP_URL}/convite/${issue.token}`));
  assert.ok(!message.html.includes("<script>"));
  assert.ok(message.html.includes("&lt;script&gt;"));
  assert.ok(!/[\r\n]/.test(message.subject));
  assert.ok(message.text.includes("09:00"));
  assert.equal(message.messageId, `<invitation-${issue.issue_id}@example.com>`);
  assert.ok(message.disableFileAccess && message.disableUrlAccess);
});
test("SMTP result distinguishes acceptance, refusal and ambiguous failures without retrying", async () => {
  let calls = 0;
  assert.equal(
    await deliverInvitation(issue, config, async () => {
      calls++;
      return { accepted: [issue.email] };
    }),
    "accepted",
  );
  assert.equal(calls, 1);
  assert.equal(
    await deliverInvitation(issue, config, async () => ({
      rejected: [issue.email],
    })),
    "rejected",
  );
  assert.equal(
    await deliverInvitation(issue, config, async () => ({
      accepted: ["different@example.com"],
    })),
    "unknown",
  );
  assert.equal(
    await deliverInvitation(issue, config, async () => {
      throw new Error("credential must never appear in result");
    }),
    "unknown",
  );
});
test("disabled configuration and synthetic destinations never invoke SMTP", async () => {
  const forbidden = async () => {
    assert.fail("must not send");
  };
  assert.equal(await deliverInvitation(issue, null, forbidden), "unavailable");
  for (const email of [
    "demo@example.invalid",
    "demo@tenant.test",
    "demo@tenant.example",
  ])
    assert.equal(
      await deliverInvitation({ ...issue, email }, config, forbidden),
      "unavailable",
    );
});
test("real Nodemailer compiles the invitation MIME locally without network delivery", async () => {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const result = await transport.sendMail(invitationMailMessage(issue, config));
  const mime = result.message.toString();
  assert.ok(mime.includes("multipart/alternative"));
  assert.ok(mime.includes(`To: ${issue.email}`));
  assert.ok(mime.includes("text/plain") && mime.includes("text/html"));
  assert.ok(!mime.includes("\nBcc:"));
  assert.ok(!mime.includes(env.TEAM_SMTP_PASSWORD));
  transport.close();
});
