import { Hono } from "hono";
import { z } from "zod";
import { ApproveBody, CreateRequestBody, Role } from "../domain.js";
import { makeService, ServiceError } from "../service.js";
import { config } from "../config.js";
import { ContactNotAllowed } from "../safety.js";

/**
 * Viewer identity comes from headers for now (single-family, private network).
 * Replace with real auth before any multi-family deployment.
 */
function viewer(c: { req: { header: (n: string) => string | undefined } }) {
  const memberId = c.req.header("x-tether-member") ?? "";
  const role = Role.safeParse(c.req.header("x-tether-role") ?? "");
  if (!memberId || !role.success) return undefined;
  return { memberId, role: role.data, name: c.req.header("x-tether-name") ?? memberId };
}

export function buildApp(service = makeService()) {
  const app = new Hono();

  app.get("/v1/health", (c) => c.json({ ok: true, dryRun: service.deps.dryRun, goal: config.calle.goalId ? "configured" : "one_shot_fallback" }));

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
    const v = viewer(c);
    if (!v) throw new ServiceError(401, "x-tether-member and x-tether-role headers required");
    const body = ApproveBody.parse(await c.req.json());
    return c.json(await service.approve(c.req.param("id"), body, v));
  });

  app.post("/v1/requests/:id/cancel", (c) => {
    const v = viewer(c);
    if (!v) throw new ServiceError(401, "x-tether-member header required");
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
