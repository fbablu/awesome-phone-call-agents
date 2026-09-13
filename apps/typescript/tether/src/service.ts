import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { ApproveBody, CreateRequestBody, type TetherRequest, type Role } from "./domain.js";
import { Store } from "./store.js";
import { makeTranscriber, type Transcriber } from "./stt/index.js";
import { makeTriager, type Triager } from "./triage/index.js";
import { placeCall } from "./calle/index.js";
import { canApprove, canViewDetail, resolveAllowlistedContact } from "./safety.js";

export interface ServiceDeps {
  store: Store;
  transcribe: Transcriber;
  triage: Triager;
  dryRun: boolean;
  place?: typeof placeCall;
}

export function makeService(overrides: Partial<ServiceDeps> = {}) {
  const deps: ServiceDeps = {
    store: overrides.store ?? new Store(config.dataDir),
    transcribe: overrides.transcribe ?? makeTranscriber(),
    triage: overrides.triage ?? makeTriager(),
    dryRun: overrides.dryRun ?? config.dryRun,
    place: overrides.place ?? placeCall,
  };
  const now = () => new Date().toISOString();

  return {
    deps,

    async createRequest(body: CreateRequestBody, audio?: { buffer: Buffer; mimeType: string; hint?: string }) {
      const req: TetherRequest = {
        id: randomUUID(),
        familyId: body.familyId,
        memberId: body.memberId,
        memberName: body.memberName,
        role: body.role,
        status: "received",
        createdAt: now(),
        updatedAt: now(),
        audit: [{ at: now(), event: "received", by: body.memberId }],
      };
      deps.store.saveRequest(req);

      let text = body.transcript ?? "";
      let provider = "device";
      if (!text && audio) {
        const r = await deps.transcribe({ audio: audio.buffer, mimeType: audio.mimeType, hint: audio.hint });
        text = r.text;
        provider = r.provider;
      }
      if (!text) throw new ServiceError(400, "transcript or audio required");
      req.transcript = { text, provider };
      req.status = "transcribed";
      req.audit.push({ at: now(), event: `transcribed:${provider}` });
      deps.store.saveRequest(req);

      const contacts = deps.store.listContacts().map((c) => ({ id: c.id, label: c.label, category: c.category }));
      req.triage = await deps.triage({ transcript: text, memberName: body.memberName, catalog: body.catalog, contacts });
      req.status = req.triage.kind === "phone_task" ? "awaiting_approval" : req.triage.kind === "clarify" ? "triaged" : "answered";
      req.audit.push({ at: now(), event: `triaged:${req.triage.kind}` });
      return deps.store.saveRequest(req);
    },

    getRequest(id: string, viewer?: { memberId: string; role: Role }) {
      const req = deps.store.getRequest(id);
      if (!req) throw new ServiceError(404, "request not found");
      if (viewer && !canViewDetail(viewer, req.memberId)) throw new ServiceError(403, "not visible to this member");
      return req;
    },

    listRequests(filter: { familyId?: string; memberId?: string }, viewer?: { memberId: string; role: Role }) {
      const rows = deps.store.listRequests(filter);
      if (!viewer || viewer.role === "caregiver") return rows;
      return rows.filter((r) => canViewDetail(viewer, r.memberId));
    },

    async approve(id: string, body: ApproveBody, approver: { memberId: string; role: Role; name: string }) {
      if (!canApprove(approver.role)) throw new ServiceError(403, "only a caregiver can approve a call");
      const req = this.getRequest(id);
      if (req.status !== "awaiting_approval" || !req.triage?.phone_task) throw new ServiceError(409, `request is ${req.status}, not awaiting approval`);
      const contact = resolveAllowlistedContact(deps.store.listContacts(), body.contactId);

      const task = { ...req.triage.phone_task };
      if (body.question) task.question = body.question;
      if (body.constraints) task.constraints = body.constraints;
      task.business_name = contact.label;

      req.approval = { by: body.by, at: now(), phone: contact.phone, contactLabel: contact.label };
      req.status = "calling";
      req.audit.push({ at: now(), event: "approved", by: approver.memberId });
      deps.store.saveRequest(req);

      try {
        const outcome = await deps.place!(
          { requestId: req.id, phone: contact.phone, contactLabel: contact.label, caregiverName: approver.name, task },
          { dryRun: deps.dryRun },
        );
        req.call = outcome;
        const r = outcome.result as { human_required?: boolean } | null;
        req.status = outcome.error ? "failed" : r?.human_required ? "needs_human" : "completed";
        req.audit.push({ at: now(), event: `call:${req.status}${outcome.dryRun ? ":dry" : ""}` });
      } catch (e) {
        req.status = "failed";
        req.audit.push({ at: now(), event: `call:error:${(e as Error).message}` });
      }
      return deps.store.saveRequest(req);
    },

    cancel(id: string, by: string) {
      const req = this.getRequest(id);
      if (["completed", "calling"].includes(req.status)) throw new ServiceError(409, `cannot cancel a ${req.status} request`);
      req.status = "cancelled";
      req.audit.push({ at: now(), event: "cancelled", by });
      return deps.store.saveRequest(req);
    },
  };
}

export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
