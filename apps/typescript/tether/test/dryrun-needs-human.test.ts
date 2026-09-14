import { test } from "node:test";
import assert from "node:assert/strict";
import { placeCall } from "../src/calle/index.js";

const base = { requestId: "r1", phone: "+15555550100", contactLabel: "Cenlar", caregiverName: "Fardeen" };

test("dry run completes normally by default", async () => {
  const o = await placeCall({ ...base, task: { business_name: "Cenlar", question: "Is the packet sent?", constraints: "", on_behalf_of: "Mom" } }, { dryRun: true });
  assert.equal(o.dryRun, true);
  assert.equal((o.result as { human_required: boolean }).human_required, false);
});

test("dry run simulates needs_human when the question carries the marker", async () => {
  const o = await placeCall({ ...base, task: { business_name: "Cenlar", question: "Is the packet sent? [needs_human]", constraints: "", on_behalf_of: "Mom" } }, { dryRun: true });
  assert.equal((o.result as { human_required: boolean }).human_required, true);
});
