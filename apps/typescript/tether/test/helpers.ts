import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../src/http/app.js";
import { makeService } from "../src/service.js";
import { Store } from "../src/store.js";
import { transcribeFixture } from "../src/stt/fixture.js";
import { triageFixture } from "../src/triage/index.js";
import { config } from "../src/config.js";
import type { probeGemini } from "../src/stt/gemini-diag.js";

/**
 * A whole app on a throwaway store, wired to the fixture transcriber and triager.
 * Tests must not depend on the developer's real .env (family token, dry-run flag).
 */
export function harness(opts: { probeGemini?: typeof probeGemini } = {}) {
  (config as { familyToken: string }).familyToken = "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tether-test-"));
  const store = new Store(dir);
  store.saveContacts(JSON.parse(fs.readFileSync("fixtures/contacts.example.json", "utf8")));
  const service = makeService({ store, transcribe: transcribeFixture, triage: triageFixture, dryRun: true });
  return { app: buildApp(service, opts), store };
}

export type App = ReturnType<typeof harness>["app"];

export const catalog = JSON.parse(fs.readFileSync("fixtures/catalog.example.json", "utf8"));

export const json = { "content-type": "application/json" };
export const caregiver = { "x-tether-member": "me", "x-tether-role": "caregiver", "x-tether-name": "Fardeen" };
export const mom = { "x-tether-member": "mom", "x-tether-role": "loved_one" };
export const dad = { "x-tether-member": "dad", "x-tether-role": "loved_one" };
export const sister = { "x-tether-member": "sis", "x-tether-role": "supporter" };

/** Set the shared family secret for one block and always put it back. */
export async function withFamilyToken(token: string, fn: () => Promise<void>): Promise<void> {
  const prev = config.familyToken;
  (config as { familyToken: string }).familyToken = token;
  try {
    await fn();
  } finally {
    (config as { familyToken: string }).familyToken = prev;
  }
}
