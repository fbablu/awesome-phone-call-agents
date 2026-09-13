/**
 * STT bake-off on the Bengali corpus. Usage:
 *   pnpm bakeoff corpus/clips/dad-setA [gemini:gemini-3.8-flash,gemini:gemini-3.5-transcribe,whisper]
 * Ground truth comes from fixtures/corpus.json (built from corpus/prompts.md).
 * Prints per-provider CER and WER; audio never leaves the machine for the whisper provider.
 */
import fs from "node:fs";
import path from "node:path";
import { loadCorpus } from "../src/stt/fixture.js";
import { transcribeWithGemini } from "../src/stt/gemini.js";
import { transcribeWithWhisper } from "../src/stt/whisper.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: pnpm bakeoff <clips-dir> [providers]");
  process.exit(1);
}
const providers = (process.argv[3] ?? "gemini:gemini-3.8-flash").split(",");
const corpus = loadCorpus();
const files = fs.readdirSync(dir).filter((f) => /^[AB]\d\d\.(wav|m4a|mp3)$/.test(f)).sort();

function norm(s: string) {
  return s.replace(/[।,.!?"'“”‘’()\-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function levenshtein(a: string[], b: string[]) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const cer = (ref: string, hyp: string) => levenshtein([...norm(ref)], [...norm(hyp)]) / Math.max(1, norm(ref).length);
const wer = (ref: string, hyp: string) => levenshtein(norm(ref).split(" "), norm(hyp).split(" ")) / Math.max(1, norm(ref).split(" ").length);

const rows: Record<string, { cer: number[]; wer: number[]; ms: number[] }> = {};
for (const p of providers) rows[p] = { cer: [], wer: [], ms: [] };

for (const f of files) {
  const id = f.slice(0, 3);
  const ref = corpus[id]?.bn;
  if (!ref) continue;
  const audio = fs.readFileSync(path.join(dir, f));
  console.log(`\n${id}  ref: ${ref}`);
  for (const p of providers) {
    const t0 = Date.now();
    try {
      const r = p.startsWith("gemini") ? await transcribeWithGemini({ audio, mimeType: "audio/wav" }, p.split(":")[1]) : await transcribeWithWhisper({ audio, mimeType: "audio/wav" });
      const c = cer(ref, r.text), w = wer(ref, r.text);
      rows[p].cer.push(c); rows[p].wer.push(w); rows[p].ms.push(Date.now() - t0);
      console.log(`  ${p.padEnd(32)} CER ${(c * 100).toFixed(0).padStart(3)}%  WER ${(w * 100).toFixed(0).padStart(3)}%  ${r.text}`);
    } catch (e) {
      console.log(`  ${p.padEnd(32)} ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log("\n| provider | clips | mean CER | mean WER | mean ms |\n|---|---|---|---|---|");
for (const p of providers) console.log(`| ${p} | ${rows[p].cer.length} | ${(mean(rows[p].cer) * 100).toFixed(1)}% | ${(mean(rows[p].wer) * 100).toFixed(1)}% | ${mean(rows[p].ms).toFixed(0)} |`);
