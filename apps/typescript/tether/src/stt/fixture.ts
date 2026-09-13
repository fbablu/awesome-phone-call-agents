import fs from "node:fs";
import path from "node:path";
import type { SttInput, SttResult } from "./index.js";

/**
 * Offline provider for tests and for judges without keys. Looks the hint
 * (a corpus card id like "A14") up in fixtures/corpus.json; otherwise returns
 * the audio buffer interpreted as UTF-8 text so tests can pass text as "audio".
 */
export async function transcribeFixture(input: SttInput): Promise<SttResult> {
  const cards = loadCorpus();
  if (input.hint && cards[input.hint]) {
    return { text: cards[input.hint].bn, provider: "fixture", language: "bn+en" };
  }
  return { text: input.audio.toString("utf8"), provider: "fixture" };
}

export function loadCorpus(): Record<string, { bn: string; gloss: string }> {
  const f = path.resolve("fixtures/corpus.json");
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
