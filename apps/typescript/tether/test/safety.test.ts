import { test } from "node:test";
import assert from "node:assert/strict";
import { redactDigits, withHardConstraints, resolveAllowlistedContact, canApprove, canViewDetail, HARD_CONSTRAINTS } from "../src/safety.js";

test("redactDigits hides account-number-like strings", () => {
  assert.equal(redactDigits("account 1234 5678 9012"), "account ########");
  assert.equal(redactDigits("call me at 7 pm"), "call me at 7 pm");
});

test("hard constraints are always appended, never replaced", () => {
  const t = withHardConstraints({ business_name: "x", question: "q", constraints: "be brief", on_behalf_of: "Mom" });
  assert.ok(t.constraints.startsWith("be brief "));
  assert.ok(t.constraints.includes(HARD_CONSTRAINTS));
});

test("only allowlisted contacts resolve", () => {
  const contacts = [{ id: "a", label: "A", phone: "+15555550100", category: "finance" as const, ownerMemberIds: [] }];
  assert.equal(resolveAllowlistedContact(contacts, "a").phone, "+15555550100");
  assert.throws(() => resolveAllowlistedContact(contacts, "spoken-number"));
});

test("roles: only caregivers approve; loved ones see their own detail", () => {
  assert.equal(canApprove("caregiver"), true);
  assert.equal(canApprove("loved_one"), false);
  assert.equal(canApprove("supporter"), false);
  assert.equal(canViewDetail({ memberId: "dad", role: "loved_one" }, "dad"), true);
  assert.equal(canViewDetail({ memberId: "dad", role: "loved_one" }, "mom"), false);
  assert.equal(canViewDetail({ memberId: "sis", role: "supporter" }, "mom"), false);
  assert.equal(canViewDetail({ memberId: "me", role: "caregiver" }, "mom"), true);
});
