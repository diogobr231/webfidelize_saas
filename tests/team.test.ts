import assert from "node:assert/strict";
import test from "node:test";
import {
  professionalMemberSchema,
  revokeMemberSchema,
  teamActionError,
  cancelInvitationSchema,
  createInvitationSchema,
  invitationError,
  invitationPage,
  invitationStatus,
} from "../src/lib/team";
const company = "00000000-0000-4000-8000-000000000001";
const professional = "00000000-0000-4000-8000-000000000002";
const member = "00000000-0000-4000-8000-000000000003";
test("team assignment accepts same-company candidates only as UUID inputs and supports unlink", () => {
  const parsed = professionalMemberSchema.parse({
    company_id: company,
    professional_id: professional,
    member_id: "",
    expected_member_id: member,
    confirm_action: "yes",
  });
  assert.equal(parsed.member_id, null);
  assert.equal(parsed.expected_member_id, member);
  assert.equal(
    professionalMemberSchema.safeParse({ ...parsed, member_id: "not-a-user" })
      .success,
    false,
  );
});

test("invitation inputs normalize email, prohibit owner and require cancellation confirmation", () => {
  assert.equal(
    createInvitationSchema.parse({
      company_id: company,
      email: "  PERSON@Example.com ",
      role: "EMPLOYEE",
    }).email,
    "person@example.com",
  );
  assert.equal(
    createInvitationSchema.safeParse({
      company_id: company,
      email: "person@example.com",
      role: "OWNER",
    }).success,
    false,
  );
  assert.equal(
    cancelInvitationSchema.safeParse({
      company_id: company,
      invitation_id: professional,
    }).success,
    false,
  );
  assert.equal(
    cancelInvitationSchema.safeParse({
      company_id: company,
      invitation_id: professional,
      confirm_action: "yes",
    }).success,
    true,
  );
});
test("invitation pagination and status expose only bounded, truthful states", () => {
  assert.equal(invitationPage("3"), 3);
  assert.equal(invitationPage("999999"), 10000);
  assert.equal(invitationPage("1.5"), 1);
  assert.equal(invitationPage(["2"]), 1);
  const invitation = {
    accepted_at: null,
    canceled_at: null,
    expires_at: "2027-01-01T00:00:00Z",
  };
  assert.equal(
    invitationStatus(invitation, Date.parse("2026-01-01")),
    "Pendente",
  );
  assert.equal(
    invitationStatus(invitation, Date.parse("2028-01-01")),
    "Expirado",
  );
  assert.equal(
    invitationStatus({ ...invitation, canceled_at: "2026-01-01" }),
    "Cancelado",
  );
  assert.equal(
    invitationStatus({ ...invitation, accepted_at: "2026-01-01" }),
    "Aceito",
  );
  assert.equal(invitationError("daily invitation limit"), "limite-convites");
  assert.equal(invitationError("invitation cooldown"), "aguarde-convite");
  assert.equal(invitationError("raw secret/token detail"), "convite");
});
test("access revocation requires explicit server-visible confirmation", () => {
  assert.equal(
    revokeMemberSchema.safeParse({ company_id: company, member_id: member })
      .success,
    false,
  );
  assert.equal(
    revokeMemberSchema.safeParse({
      company_id: company,
      member_id: member,
      confirm_action: "no",
    }).success,
    false,
  );
  assert.equal(
    revokeMemberSchema.safeParse({
      company_id: company,
      member_id: member,
      confirm_action: "yes",
    }).success,
    true,
  );
});
test("team errors expose actionable codes without database internals", () => {
  assert.equal(
    teamActionError("assignment version conflict"),
    "vinculo-atualizado",
  );
  assert.equal(teamActionError("member already assigned"), "conta-vinculada");
  assert.equal(teamActionError("confirmation required"), "confirmacao");
  assert.equal(teamActionError("sensitive detail"), "vinculo");
});
