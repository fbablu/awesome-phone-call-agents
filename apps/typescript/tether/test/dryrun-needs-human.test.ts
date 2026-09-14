import { test } from "node:test";
import assert from "node:assert/strict";
import { placeCall } from "../src/calle/index.js";

const base = { requestId: "r1", phone: "+15555550100", contactLabel: "Cenlar", caregiverName: "Fardeen" };

type DryResult = {
  human_required: boolean;
  details: string;
  next_steps: string;
  channel: string;
};

test("dry run completes normally by default", async () => {
  const o = await placeCall({ ...base, task: { business_name: "Cenlar", question: "Is the packet sent?", constraints: "", on_behalf_of: "Mom" } }, { dryRun: true });
  assert.equal(o.dryRun, true);
  assert.equal((o.result as DryResult).human_required, false);
});

test("dry run simulates needs_human when the question carries the marker", async () => {
  const o = await placeCall({ ...base, task: { business_name: "Cenlar", question: "Is the packet sent? [needs_human]", constraints: "", on_behalf_of: "Mom" } }, { dryRun: true });
  const result = o.result as DryResult;
  assert.equal(result.human_required, true);
  // The marker is a test hook, not something a caregiver should ever read.
  assert.doesNotMatch(result.details, /needs_human/);
  assert.match(result.details, /Is the packet sent\?/);
  assert.equal(result.channel, "phone");
  assert.match(result.next_steps, /account holder/i);
});
