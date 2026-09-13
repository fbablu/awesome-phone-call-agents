import { z } from "zod";

export const Role = z.enum(["caregiver", "supporter", "loved_one"]);
export type Role = z.infer<typeof Role>;

/**
 * A catalog entry describes something the family app knows, WITHOUT the value.
 * The server never sees balances; it only learns that a slot exists so the
 * triage model can reference it. The app substitutes the real value on device.
 */
export const CatalogEntry = z.object({
  slot: z.string().regex(/^[a-z0-9_.-]+$/i),
  owner: z.string(),
  label: z.string(),
  kind: z.enum(["balance", "debt", "due_date", "amount", "status", "document", "contact", "other"]),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const TriageKind = z.enum(["answer_from_data", "general_answer", "phone_task", "clarify"]);
export type TriageKind = z.infer<typeof TriageKind>;

export const PhoneTask = z.object({
  business_name: z.string(),
  question: z.string(),
  constraints: z.string().default(""),
  on_behalf_of: z.string(),
});
export type PhoneTask = z.infer<typeof PhoneTask>;

export const Triage = z.object({
  kind: TriageKind,
  /** One-line English restatement of what the person asked. Apple-summary style. */
  summary_en: z.string(),
  /** Bengali read-back for the person who asked. */
  readback_bn: z.string(),
  /** Answer template using {{slot}} placeholders from the catalog. Never contains numbers. */
  answer_template_en: z.string().optional(),
  answer_template_bn: z.string().optional(),
  slots_used: z.array(z.string()).default([]),
  /** Exact steps for the caregiver, when a human must finish it. */
  steps: z.array(z.string()).default([]),
  phone_task: PhoneTask.optional(),
  urgency: z.enum(["low", "normal", "high"]).default("normal"),
});
export type Triage = z.infer<typeof Triage>;

export const RequestStatus = z.enum([
  "received",
  "transcribed",
  "triaged",
  "awaiting_approval",
  "approved",
  "calling",
  "completed",
  "needs_human",
  "answered",
  "cancelled",
  "failed",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const CallOutcome = z.object({
  provider: z.literal("calle"),
  mode: z.enum(["goal", "one_shot"]),
  dryRun: z.boolean(),
  goalRunId: z.string().nullable(),
  callId: z.string().nullable(),
  status: z.string(),
  result: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CallOutcome = z.infer<typeof CallOutcome>;

export const TetherRequest = z.object({
  id: z.string(),
  familyId: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  role: Role,
  status: RequestStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  transcript: z
    .object({ text: z.string(), provider: z.string(), language: z.string().optional() })
    .optional(),
  triage: Triage.optional(),
  approval: z
    .object({ by: z.string(), at: z.string(), phone: z.string(), contactLabel: z.string() })
    .optional(),
  call: CallOutcome.optional(),
  audit: z.array(z.object({ at: z.string(), event: z.string(), by: z.string().optional() })),
});
export type TetherRequest = z.infer<typeof TetherRequest>;

export const CreateRequestBody = z.object({
  familyId: z.string().default("default"),
  memberId: z.string(),
  memberName: z.string(),
  role: Role,
  /** Either a transcript (already transcribed on device) or audio via multipart. */
  transcript: z.string().optional(),
  /** Labels only. Values stay on the device. */
  catalog: z.array(CatalogEntry).default([]),
});
export type CreateRequestBody = z.infer<typeof CreateRequestBody>;

export const ApproveBody = z.object({
  by: z.string(),
  /** Which allowlisted contact to call. Must match data/contacts.json. */
  contactId: z.string(),
  /** Optional edits the caregiver made before approving. */
  question: z.string().optional(),
  constraints: z.string().optional(),
});
export type ApproveBody = z.infer<typeof ApproveBody>;

/** Contacts are the ONLY numbers the system may dial. Entered by the family, never by voice. */
export const Contact = z.object({
  id: z.string(),
  label: z.string(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164 required"),
  category: z.enum(["finance", "health", "property", "utility", "government", "other"]),
  ownerMemberIds: z.array(z.string()).default([]),
});
export type Contact = z.infer<typeof Contact>;
