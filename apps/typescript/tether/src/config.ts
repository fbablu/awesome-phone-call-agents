import "dotenv/config";
import path from "node:path";

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.TETHER_PORT ?? 8787),
  /** Dry-run is the default. Nothing dials unless TETHER_DRY_RUN=false. */
  dryRun: bool(process.env.TETHER_DRY_RUN, true),
  dataDir: process.env.TETHER_DATA_DIR ?? path.resolve("data"),

  calle: {
    apiKey: process.env.TETHER_CALLE_API_KEY ?? process.env.KOTHA_CALLE_DEV_API_KEY ?? "",
    baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
    goalId: process.env.TETHER_GOAL_ID ?? "",
    region: process.env.TETHER_CALLE_REGION ?? "US",
    locale: process.env.TETHER_CALLE_LOCALE ?? "en-US",
    waitTimeoutMs: Number(process.env.TETHER_CALLE_TIMEOUT_MS ?? 15 * 60_000),
  },

  stt: {
    /** gemini | whisper | fixture */
    provider: process.env.TETHER_STT ?? "fixture",
    geminiModel: process.env.TETHER_STT_MODEL ?? "gemini-3.8-flash",
    whisperBin: process.env.TETHER_WHISPER_BIN ?? "whisper-cli",
    whisperModel: process.env.TETHER_WHISPER_MODEL ?? "",
  },

  triage: {
    /** gemini | fixture */
    provider: process.env.TETHER_TRIAGE ?? "fixture",
    geminiModel: process.env.TETHER_TRIAGE_MODEL ?? "gemini-3.8-flash",
  },

  geminiApiKey: process.env.TETHER_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "",
};

export type Config = typeof config;
