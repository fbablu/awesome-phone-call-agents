import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import type { SttInput, SttResult } from "./index.js";

const PROMPT =
  "Transcribe this audio exactly as spoken. The speaker is an older Bengali speaker who mixes Bengali (Bangla) and English words in the same sentence. " +
  "Write Bengali words in Bengali script and keep English words (like 'appointment', 'refill', 'insurance') in Latin script exactly as said. " +
  "Do not translate. Do not add anything. Return only the transcript.";

export async function transcribeWithGemini(input: SttInput, model = config.stt.geminiModel): Promise<SttResult> {
  if (!config.geminiApiKey) throw new Error("TETHER_GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: input.mimeType, data: input.audio.toString("base64") } },
          { text: PROMPT },
        ],
      },
    ],
  });
  const text = (res.text ?? "").trim();
  return { text, provider: `gemini:${model}`, language: "bn+en" };
}
