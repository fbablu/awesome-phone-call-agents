import { Hono } from "hono";
import { z } from "zod";
import { ApproveBody, ConsentBody, CreateRequestBody, Role } from "../domain.js";
import { makeService, ServiceError } from "../service.js";
import { config } from "../config.js";
import { ContactNotAllowed } from "../safety.js";
import { probeGemini, type GeminiProbeResult } from "../stt/gemini-diag.js";

type HeaderCtx = { req: { header: (n: string) => string | undefined } };

/**
 * Viewer identity comes from headers for now (single-family, private network).
 * Replace with real auth before any multi-family deployment.
 */
function viewer(c: HeaderCtx) {
  const memberId = c.req.header("x-tether-member") ?? "";
  const role = Role.safeParse(c.req.header("x-tether-role") ?? "");
  if (!memberId || !role.success) return undefined;
  return { memberId, role: role.data, name: c.req.header("x-tether-name") ?? memberId };
}

const VIEWER_HEADERS_REQUIRED = "x-tether-member and x-tether-role headers required";

/** Every member-scoped route needs a viewer; a missing or unreadable role is a 401, not a 403. */
function requireViewer(c: HeaderCtx, missing = VIEWER_HEADERS_REQUIRED) {
  const v = viewer(c);
  if (!v) throw new ServiceError(401, missing);
  return v;
}

/** The only paths outside the family-token gate, so a phone can tell "wrong token" from "unreachable". */
const OPEN_PATHS = new Set(["/v1/health", "/v1/health/gemini"]);

/** A live probe costs a Google call, so repeated hits inside this window reuse the last answer. */
const PROBE_CACHE_MS = 30_000;

export function buildApp(service = makeService(), opts: { probeGemini?: typeof probeGemini } = {}) {
  const app = new Hono();
  const probe = opts.probeGemini ?? probeGemini;
  let cached: { at: number; result: GeminiProbeResult } | undefined;

  app.get("/", (c) => c.text("tether-server is running. Try /v1/health"));

  // Shared family secret.
  app.use("/v1/*", async (c, next) => {
    if (OPEN_PATHS.has(c.req.path) || !config.familyToken) return next();
    if (c.req.header("x-tether-token") !== config.familyToken) return c.json({ error: "invalid family token" }, 401);
    return next();
  });

  app.get("/v1/health", (c) =>
    c.json({
      ok: true,
      dryRun: service.deps.dryRun,
      goal: config.calle.goalId ? "configured" : "one_shot_fallback",
      stt: config.stt.provider,
      triage: config.triage.provider,
      keys: { calle: Boolean(config.calle.apiKey), gemini: Boolean(config.geminiApiKey) },
      tokenRequired: Boolean(config.familyToken),
      envNames: config.envNames,
    }),
  );

  // Debug a Gemini key without opening .env. Returns the key shape and length, never the key.
  app.get("/v1/health/gemini", async (c) => {
    if (cached && Date.now() - cached.at < PROBE_CACHE_MS) return c.json({ ...cached.result, cachedAt: new Date(cached.at).toISOString() });
    const result = await probe();
    cached = { at: Date.now(), result };
    return c.json(result);
  });

  app.get("/v1/contacts", (c) => c.json(service.deps.store.listContacts().map(({ phone, ...rest }) => ({ ...rest, phoneMasked: phone.slice(0, 3) + "***" + phone.slice(-2) }))));

  app.post("/v1/requests", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    let body: unknown;
    let audio: { buffer: Buffer; mimeType: string; hint?: string } | undefined;
    if (ct.startsWith("multipart/form-data")) {
      const form = await c.req.formData();
      const meta = form.get("meta");
      body = JSON.parse(typeof meta === "string" ? meta : "{}");
      const file = form.get("audio");
      if (file && typeof file !== "string") {
        audio = { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type || "audio/m4a", hint: (form.get("hint") as string) || undefined };
      }
    } else {
      body = await c.req.json();
    }
    const parsed = CreateRequestBody.parse(body);
    const req = await service.createRequest(parsed, audio);
    return c.json(req, 201);
  });

  app.get("/v1/requests", (c) => {
    const q = z.object({ familyId: z.string().optional(), memberId: z.string().optional() }).parse(c.req.query());
    return c.json(service.listRequests(q, viewer(c)));
  });

  app.get("/v1/requests/:id", (c) => c.json(service.getRequest(c.req.param("id"), viewer(c))));

  app.post("/v1/requests/:id/approve", async (c) => {
    const v = requireViewer(c);
    const body = ApproveBody.parse(await c.req.json());
    return c.json(await service.approve(c.req.param("id"), body, v));
  });

  app.post("/v1/requests/:id/consent", async (c) => {
    const v = requireViewer(c);
    const body = ConsentBody.parse(await c.req.json());
    return c.json(service.consent(c.req.param("id"), body, v));
  });

  app.post("/v1/requests/:id/cancel", (c) => {
    const v = requireViewer(c, "x-tether-member header required");
    return c.json(service.cancel(c.req.param("id"), v.memberId));
  });

  app.onError((err, c) => {
    if (err instanceof ServiceError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof ContactNotAllowed) return c.json({ error: err.message }, 400);
    if (err instanceof z.ZodError) return c.json({ error: "invalid body", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
