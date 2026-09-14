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
import { config } from "../src/config.js";

function harness() {
  // Tests must not depend on the developer's real .env (family token, dry-run flag).
  (config as { familyToken: string }).familyToken = "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tether-consent-"));
  const store = new Store(dir);
  store.saveContacts(JSON.parse(fs.readFileSync("fixtures/contacts.example.json", "utf8")));
  const service = makeService({ store, transcribe: transcribeFixture, triage: triageFixture, dryRun: true });
  return { app: buildApp(service), store };
}
const catalog = JSON.parse(fs.readFileSync("fixtures/catalog.example.json", "utf8"));
const caregiver = { "x-tether-member": "me", "x-tether-role": "caregiver", "x-tether-name": "Fardeen" };
const mom = { "x-tether-member": "mom", "x-tether-role": "loved_one" };
const sister = { "x-tether-member": "sis", "x-tether-role": "supporter" };
const json = { "content-type": "application/json" };

type App = ReturnType<typeof harness>["app"];

async function pending(app: App) {
  const res = await app.request("/v1/requests", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ memberId: "mom", memberName: "Mom", role: "loved_one", transcript: "Cenlar loan is paid in full, where is the paid in full packet?", catalog }),
  });
  const req = await res.json();
  assert.equal(req.status, "awaiting_approval");
  return req as { id: string };
}

test("the person the call concerns can give consent, and the call then goes through", async () => {
  const { app } = harness();
  const req = await pending(app);

  const res = await app.request(`/v1/requests/${req.id}/consent`, {
    method: "POST",
    headers: { ...json, ...mom },
    body: JSON.stringify({ state: "given", answeredCorrectly: true }),
  });
  assert.equal(res.status, 200);
  const withConsent = await res.json();
  assert.equal(withConsent.consent.state, "given");
  assert.equal(withConsent.consent.by, "mom");
  assert.equal(withConsent.consent.answeredCorrectly, true);
  assert.equal(typeof withConsent.consent.at, "string");
  assert.equal(withConsent.status, "awaiting_approval", "consent does not approve the call by itself");
  assert.ok(withConsent.audit.some((a: { event: string }) => a.event === "consent:given"));

  const ok = await app.request(`/v1/requests/${req.id}/approve`, {
    method: "POST",
    headers: { ...json, ...caregiver },
    body: JSON.stringify({ by: "me", contactId: "cenlar" }),
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, "completed");
});

test("a decline cancels the request and no caregiver can override it", async () => {
  const { app } = harness();
  const req = await pending(app);

  const res = await app.request(`/v1/requests/${req.id}/consent`, {
    method: "POST",
    headers: { ...json, ...mom },
    body: JSON.stringify({ state: "declined", answeredCorrectly: false }),
  });
  assert.equal(res.status, 200);
  const declined = await res.json();
  assert.equal(declined.consent.state, "declined");
  assert.equal(declined.status, "cancelled");
  assert.ok(declined.audit.some((a: { event: string }) => a.event === "consent:declined"));

  const blocked = await app.request(`/v1/requests/${req.id}/approve`, {
    method: "POST",
    headers: { ...json, ...caregiver },
    body: JSON.stringify({ by: "me", contactId: "cenlar" }),
  });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /declined/);
});

test("another member cannot answer for the person the call concerns", async () => {
  const { app } = harness();
  const req = await pending(app);

  const res = await app.request(`/v1/requests/${req.id}/consent`, {
    method: "POST",
    headers: { ...json, ...sister },
    body: JSON.stringify({ state: "given" }),
  });
  assert.equal(res.status, 403);

  const anon = await app.request(`/v1/requests/${req.id}/consent`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ state: "given" }),
  });
  assert.equal(anon.status, 401);
});

test("consent only applies while the request is still awaiting approval", async () => {
  const { app } = harness();
  const req = await pending(app);

  const ok = await app.request(`/v1/requests/${req.id}/approve`, {
    method: "POST",
    headers: { ...json, ...caregiver },
    body: JSON.stringify({ by: "me", contactId: "cenlar" }),
  });
  assert.equal(ok.status, 200);

  const late = await app.request(`/v1/requests/${req.id}/consent`, {
    method: "POST",
    headers: { ...json, ...mom },
    body: JSON.stringify({ state: "declined" }),
  });
  assert.equal(late.status, 409);

  const missing = await app.request("/v1/requests/does-not-exist/consent", {
    method: "POST",
    headers: { ...json, ...mom },
    body: JSON.stringify({ state: "given" }),
  });
  assert.equal(missing.status, 404);
});
