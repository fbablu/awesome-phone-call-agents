import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

/**
 * One cheap text call to Gemini per configured model so a developer can tell a bad key
 * from a bad network without opening .env. Never returns any part of the key, only its
 * shape and length. STT and triage usually share one model, so that is usually one call.
 */

export type GeminiKeyFormat = "legacy_aiza" | "auth_key_aq" | "unknown";

export type GeminiModelProbe =
  | { ok: true; sample: string }
  | { ok: false; httpStatus: number | null; googleStatus: string | null; reason: string };

export type GeminiProbeResult =
  | { ok: false; reason: "no_key" }
  | {
      ok: boolean;
      keyFormat: GeminiKeyFormat;
      keyLength: number;
      models: Record<string, GeminiModelProbe>;
    };

const PROBE_PROMPT = "Reply with the single word OK";
/** Keep an unparsed provider error short enough to read in a terminal. */
const REASON_MAX = 120;

function keyFormatOf(key: string): GeminiKeyFormat {
  if (key.startsWith("AIza")) return "legacy_aiza";
  if (key.startsWith("AQ.")) return "auth_key_aq";
  return "unknown";
}

/** The SDK puts a JSON body in ApiError.message. Pull out what is useful, give up quietly if it is not JSON. */
function parseApiError(message: string): { httpStatus: number | null; googleStatus: string | null; reason: string } {
  const fallback = { httpStatus: null, googleStatus: null, reason: message.slice(0, REASON_MAX) };
  const start = message.indexOf("{");
  if (start < 0) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.slice(start));
  } catch {
    return fallback;
  }
  const err = (parsed as { error?: Record<string, unknown> } | null)?.error;
  if (!err || typeof err !== "object") return fallback;
  const httpStatus = typeof err.code === "number" ? err.code : null;
  const googleStatus = typeof err.status === "string" ? err.status : null;
  const details = Array.isArray(err.details) ? (err.details as Array<Record<string, unknown>>) : [];
  const detailReason = details.map((d) => d?.reason).find((r): r is string => typeof r === "string" && r.length > 0);
  const msg = typeof err.message === "string" ? err.message : message;
  return { httpStatus, googleStatus, reason: (detailReason ?? msg).slice(0, 200) };
}

async function defaultGenerate(model: string, signal: AbortSignal): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: PROBE_PROMPT }] }],
    config: { abortSignal: signal },
  });
  return (res.text ?? "").trim();
}

async function probeModel(model: string, timeoutMs: number, generate?: (model: string) => Promise<string>): Promise<GeminiModelProbe> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`gemini probe timeout after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    const call = generate ? generate(model) : defaultGenerate(model, controller.signal);
    const text = await Promise.race([call, timeout]);
    return { ok: true, sample: text.slice(0, 20) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, ...parseApiError(message) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Every distinct model the app would use. One entry when STT and triage share a model. */
function probeModelNames(): string[] {
  return [...new Set([config.stt.geminiModel, config.triage.geminiModel].filter(Boolean))];
}

export async function probeGemini(
  opts: {
    /** Override the configured models with a single one. */
    model?: string;
    timeoutMs?: number;
    generate?: (model: string) => Promise<string>;
  } = {},
): Promise<GeminiProbeResult> {
  const key = config.geminiApiKey;
  if (!key) return { ok: false, reason: "no_key" };

  const models = opts.model ? [opts.model] : probeModelNames();
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const results: Record<string, GeminiModelProbe> = {};
  for (const model of models) {
    results[model] = await probeModel(model, timeoutMs, opts.generate);
  }

  return {
    ok: models.length > 0 && models.every((m) => results[m].ok),
    keyFormat: keyFormatOf(key),
    keyLength: key.length,
    models: results,
  };
}
