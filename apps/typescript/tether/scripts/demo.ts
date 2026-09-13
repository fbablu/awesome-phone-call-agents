/** End-to-end dry run without keys or phones. `pnpm demo` */
import fs from "node:fs";
import { buildApp } from "../src/http/app.js";
import { makeService } from "../src/service.js";
import { Store } from "../src/store.js";
import { transcribeFixture } from "../src/stt/fixture.js";
import { triageFixture } from "../src/triage/index.js";

const store = new Store(".demo-data");
store.saveContacts(JSON.parse(fs.readFileSync("fixtures/contacts.example.json", "utf8")));
const app = buildApp(makeService({ store, transcribe: transcribeFixture, triage: triageFixture, dryRun: true }));
const catalog = JSON.parse(fs.readFileSync("fixtures/catalog.example.json", "utf8"));

const say = async (memberId: string, memberName: string, hint: string) => {
  const form = new FormData();
  form.set("meta", JSON.stringify({ memberId, memberName, role: "loved_one", catalog }));
  form.set("hint", hint);
  form.set("audio", new Blob([new Uint8Array(1)], { type: "audio/wav" }), `${hint}.wav`);
  const r = await (await app.request("/v1/requests", { method: "POST", body: form })).json();
  console.log(`\n[${hint}] ${memberName} said: ${r.transcript.text}`);
  console.log(`  -> ${r.triage.kind} | ${r.triage.summary_en}`);
  console.log(`  -> readback: ${r.triage.readback_bn}`);
  return r;
};

const a09 = await say("dad", "Dad", "A09");
console.log(`  answer template: ${a09.triage.answer_template_en}`);
const a14 = await say("dad", "Dad", "A14");
const approved = await (
  await app.request(`/v1/requests/${a14.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tether-member": "me", "x-tether-role": "caregiver", "x-tether-name": "Fardeen" },
    body: JSON.stringify({ by: "me", contactId: "insurer" }),
  })
).json();
console.log(`  approved -> ${approved.status} (${approved.call.mode}, dryRun=${approved.call.dryRun})`);
console.log(`  result: ${JSON.stringify(approved.call.result, null, 2)}`);
fs.rmSync(".demo-data", { recursive: true, force: true });
