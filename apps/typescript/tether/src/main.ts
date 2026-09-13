import { serve } from "@hono/node-server";
import { buildApp } from "./http/app.js";
import { config } from "./config.js";

const app = buildApp();
serve({ fetch: app.fetch, port: config.port, hostname: process.env.TETHER_HOST ?? "0.0.0.0" }, (info) => {
  console.log(`tether-server on http://${info.address}:${info.port}  dryRun=${config.dryRun}  stt=${config.stt.provider}  triage=${config.triage.provider}  goal=${config.calle.goalId ? "set" : "unset (one-shot fallback)"}`);
});
