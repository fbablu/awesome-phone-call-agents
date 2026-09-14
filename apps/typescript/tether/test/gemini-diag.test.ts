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

function withModels(stt: string, triage: string, fn: () => Promise<void>): Promise<void> {
  const prev = { stt: config.stt.geminiModel, triage: config.triage.geminiModel };
  config.stt.geminiModel = stt;
  config.triage.geminiModel = triage;
  return fn().finally(() => {
    config.stt.geminiModel = prev.stt;
    config.triage.geminiModel = prev.triage;
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

test("a working key reports ok with the key shape and a short sample per model", async () => {
  await withKey("AIzaFAKEFAKEFAKE", async () => {
    const res = await probeGemini({ model: "gemini-test", generate: async () => "OK" });
    assert.deepEqual(res, {
      ok: true,
      keyFormat: "legacy_aiza",
      keyLength: 16,
      models: { "gemini-test": { ok: true, sample: "OK" } },
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
      keyFormat: "auth_key_aq",
      keyLength: 11,
      models: {
        "gemini-test": { ok: false, httpStatus: 401, googleStatus: "UNAUTHENTICATED", reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" },
      },
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
      keyFormat: "unknown",
      keyLength: 13,
      models: { "gemini-test": { ok: false, httpStatus: null, googleStatus: null, reason: "boom" } },
    });
  });
});

test("a hung call times out instead of hanging the health endpoint", async () => {
  await withKey("AIzaFAKEFAKEFAKE", async () => {
    const res = await probeGemini({ model: "gemini-test", timeoutMs: 5, generate: () => new Promise<string>(() => {}) });
    assert.equal(res.ok, false);
    const models = (res as { models: Record<string, { ok: boolean; reason?: string }> }).models;
    assert.equal(models["gemini-test"].ok, false);
    assert.match(models["gemini-test"].reason ?? "", /timeout/);
  });
});

test("two distinct configured models produce two entries", async () => {
  await withKey("AIzaFAKEFAKEFAKE", async () => {
    await withModels("gemini-stt", "gemini-triage", async () => {
      const asked: string[] = [];
      const res = await probeGemini({
        generate: async (model) => {
          asked.push(model);
          return model === "gemini-stt" ? "OK" : "";
        },
      });
      assert.deepEqual(asked, ["gemini-stt", "gemini-triage"]);
      assert.deepEqual(res, {
        ok: true,
        keyFormat: "legacy_aiza",
        keyLength: 16,
        models: { "gemini-stt": { ok: true, sample: "OK" }, "gemini-triage": { ok: true, sample: "" } },
      });
    });
  });
});

test("one shared model is probed once", async () => {
  await withKey("AIzaFAKEFAKEFAKE", async () => {
    await withModels("gemini-same", "gemini-same", async () => {
      let calls = 0;
      const res = await probeGemini({
        generate: async () => {
          calls += 1;
          return "OK";
        },
      });
      assert.equal(calls, 1);
      assert.deepEqual(Object.keys((res as { models: Record<string, unknown> }).models), ["gemini-same"]);
    });
  });
});
