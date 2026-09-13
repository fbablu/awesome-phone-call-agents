import { config } from "../config.js";
import { transcribeWithGemini } from "./gemini.js";
import { transcribeWithWhisper } from "./whisper.js";
import { transcribeFixture } from "./fixture.js";

export interface SttInput {
  audio: Buffer;
  mimeType: string;
  /** Optional hint such as the corpus card id, used by the fixture provider. */
  hint?: string;
}

export interface SttResult {
  text: string;
  provider: string;
  language?: string;
}

export type Transcriber = (input: SttInput) => Promise<SttResult>;

export function makeTranscriber(provider = config.stt.provider): Transcriber {
  switch (provider) {
    case "gemini":
      return transcribeWithGemini;
    case "whisper":
      return transcribeWithWhisper;
    case "fixture":
      return transcribeFixture;
    default:
      throw new Error(`unknown STT provider ${provider}`);
  }
}
