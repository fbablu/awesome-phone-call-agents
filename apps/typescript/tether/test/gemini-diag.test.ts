import { test } from "node:test";
import assert from "node:assert/strict";
import { probeGemini } from "../src/stt/gemini-diag.js";
import { config } from "../src/config.js";

// Tests must not depend on the developer's real .env, and must never dial Google.
function withKey(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = config.geminiApiKey;
  (config as { geminiApiKey: string }).geminiApiKey = key;
  return fn().finally(() => {
    (config as { geminiApiKey: string }).geminiApiKey = prev;
  });
}

const API_ERROR_JSON = JSON.stringify({
  error: {
    code: 401,
    message: "Request had invalid authentication credentials.",
    status: "UNAUTHENTICATED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" }],
  },
});

test("no key reports no_key and never calls out", async () => {
  await withKey("", async () => {
    const res = await probeGemini({
      generate: async () => {
        throw new Error("must not be called without a key");
      },
    });
    assert.deepEqual(res, { ok: false, reason: "no_key" });
  });
});

test("a working key reports ok with the key shape and a short sample", async () => {
  await withKey("AIzaFAKEFAKEFAKE", async () => {
    const res = await probeGemini({ model: "gemini-test", generate: async () => "OK" });
    assert.deepEqual(res, {
      ok: true,
      model: "gemini-test",
      keyFormat: "legacy_aiza",
      keyLength: 16,
      sample: "OK",
    });
  });
});

test("an ApiError JSON message is unpacked into http, google status, and reason", async () => {
  await withKey("AQ.FAKEFAKE", async () => {
    const res = await probeGemini({
      model: "gemini-test",
      generate: async () => {
        throw new Error(API_ERROR_JSON);
      },
    });
    assert.deepEqual(res, {
      ok: false,
      model: "gemini-test",
      keyFormat: "auth_key_aq",
      keyLength: 11,
      httpStatus: 401,
      googleStatus: "UNAUTHENTICATED",
      reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED",
    });
  });
});

test("a plain error falls back to the message with no invented status", async () => {
  await withKey("somethingelse", async () => {
    const res = await probeGemini({
      model: "gemini-test",
      generate: async () => {
        throw new Error("boom");
      },
    });
    assert.deepEqual(res, {
      ok: false,
      model: "gemini-test",
      keyFormat: "unknown",
      keyLength: 13,
      httpStatus: null,
      googleStatus: null,
      reason: "boom",
    });
  });
});
