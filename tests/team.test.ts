import assert from "node:assert/strict";
import test from "node:test";
import {
  professionalMemberSchema,
  revokeMemberSchema,
  teamActionError,
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
