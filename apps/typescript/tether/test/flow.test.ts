import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/http/app.js";
import { makeService } from "../src/service.js";
import { Store } from "../src/store.js";
import { transcribeFixture } from "../src/stt/fixture.js";
import { triageFixture } from "../src/triage/index.js";

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tether-test-"));
  const store = new Store(dir);
  store.saveContacts(JSON.parse(fs.readFileSync("fixtures/contacts.example.json", "utf8")));
  const service = makeService({ store, transcribe: transcribeFixture, triage: triageFixture, dryRun: true });
  return { app: buildApp(service), store };
}
const catalog = JSON.parse(fs.readFileSync("fixtures/catalog.example.json", "utf8"));
const caregiver = { "x-tether-member": "me", "x-tether-role": "caregiver", "x-tether-name": "Fardeen" };
const parent = { "x-tether-member": "dad", "x-tether-role": "loved_one" };

test("balance question is answered from data with a slot, never a number", async () => {
  const { app } = harness();
  const res = await app.request("/v1/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberId: "dad", memberName: "Dad", role: "loved_one", transcript: "আমার account এ কত টাকা আছে একটু বলো।", catalog }),
  });
  assert.equal(res.status, 201);
  const req = await res.json();
  assert.equal(req.status, "answered");
  assert.equal(req.triage.kind, "answer_from_data");
  assert.match(req.triage.answer_template_en, /\{\{[a-z.]+\}\}/);
  assert.doesNotMatch(req.triage.answer_template_en, /\d/);
});

test("phone task waits for caregiver approval, loved one cannot approve, dry-run completes", async () => {
  const { app } = harness();
  const create = await app.request("/v1/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberId: "mom", memberName: "Mom", role: "loved_one", transcript: "Cenlar loan is paid in full, where is the paid in full packet?", catalog }),
  });
  const req = await create.json();
  assert.equal(req.status, "awaiting_approval");
  assert.equal(req.triage.kind, "phone_task");

  const denied = await app.request(`/v1/requests/${req.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...parent },
    body: JSON.stringify({ by: "dad", contactId: "cenlar" }),
  });
  assert.equal(denied.status, 403);

  const bad = await app.request(`/v1/requests/${req.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...caregiver },
    body: JSON.stringify({ by: "me", contactId: "number-mom-said-out-loud" }),
  });
  assert.equal(bad.status, 400);

  const ok = await app.request(`/v1/requests/${req.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...caregiver },
    body: JSON.stringify({ by: "me", contactId: "cenlar" }),
  });
  assert.equal(ok.status, 200);
  const done = await ok.json();
  assert.equal(done.status, "completed");
  assert.equal(done.call.dryRun, true);
  assert.equal(done.approval.contactLabel, "Cenlar (mortgage servicer)");
  assert.ok(done.audit.some((a: { event: string }) => a.event.startsWith("call:completed")));

  const momView = await app.request(`/v1/requests/${req.id}`, { headers: { "x-tether-member": "mom", "x-tether-role": "loved_one" } });
  assert.equal(momView.status, 200, "the person the call concerns can always see it");
  const dadView = await app.request(`/v1/requests/${req.id}`, { headers: parent });
  assert.equal(dadView.status, 403);
});

test("multipart audio goes through the transcriber using the corpus hint", async () => {
  const { app } = harness();
  const form = new FormData();
  form.set("meta", JSON.stringify({ memberId: "dad", memberName: "Dad", role: "loved_one", catalog }));
  form.set("hint", "A14");
  form.set("audio", new Blob([new Uint8Array([0, 1, 2])], { type: "audio/wav" }), "A14.wav");
  const res = await app.request("/v1/requests", { method: "POST", body: form });
  assert.equal(res.status, 201);
  const req = await res.json();
  assert.match(req.transcript.text, /Insurance/);
  assert.equal(req.triage.kind, "phone_task");
});
