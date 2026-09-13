import { CalleClient } from "@call-e/calle";
import { config } from "../config.js";
import { CallOutcome, type PhoneTask } from "../domain.js";
import { withHardConstraints } from "../safety.js";

export interface PlaceCallInput {
  requestId: string;
  phone: string;
  contactLabel: string;
  caregiverName: string;
  task: PhoneTask;
  /** bump to re-run the same request; otherwise CALL-E replays idempotently */
  attempt?: number;
}

/**
 * Runs the published Tether Goal when TETHER_GOAL_ID is set, otherwise falls
 * back to a one-shot call with the same structured result. Dry-run by default:
 * no network call is made and a synthetic outcome is returned so the whole
 * loop can be exercised without a phone.
 */
export async function placeCall(input: PlaceCallInput, opts: { dryRun?: boolean } = {}): Promise<CallOutcome> {
  const dryRun = opts.dryRun ?? config.dryRun;
  const task = withHardConstraints(input.task);
  const startedAt = new Date().toISOString();
  const idempotencyKey = `tether:${input.requestId}:attempt-${input.attempt ?? 1}`;
  const mode: "goal" | "one_shot" = config.calle.goalId ? "goal" : "one_shot";

  if (dryRun) {
    return CallOutcome.parse({
      provider: "calle",
      mode,
      dryRun: true,
      goalRunId: mode === "goal" ? `dry_${input.requestId}` : null,
      callId: `dry_call_${input.requestId}`,
      status: "completed",
      result: {
        answer: "unknown",
        details: `[DRY RUN] Would call ${input.contactLabel} (${maskPhone(input.phone)}) on behalf of ${task.on_behalf_of}: ${task.question}`,
        human_required: false,
        next_steps: "Set TETHER_DRY_RUN=false to place a real call.",
        channel: "unknown",
        reference_number: "",
        callback_needed: false,
      },
      error: null,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  }

  if (!config.calle.apiKey) throw new Error("TETHER_CALLE_API_KEY is not set");
  const client = new CalleClient({ apiKey: config.calle.apiKey, baseUrl: config.calle.baseUrl });

  if (mode === "goal") {
    const run = await client.goals.runAndWait(
      {
        goalId: config.calle.goalId,
        phone: input.phone,
        variables: {
          on_behalf_of: task.on_behalf_of,
          caregiver_name: input.caregiverName,
          business_name: task.business_name || input.contactLabel,
          question: task.question,
          constraints: task.constraints,
        },
        idempotencyKey,
      },
      { timeoutMs: config.calle.waitTimeoutMs },
    );
    return CallOutcome.parse({
      provider: "calle",
      mode,
      dryRun: false,
      goalRunId: run.id,
      callId: run.callId,
      status: run.status,
      result: run.result,
      error: run.error ? `${run.error.code}: ${run.error.message}` : null,
      startedAt,
      completedAt: run.completedAt,
    });
  }

  const call = await client.calls.createAndWait(
    {
      task: oneShotTask(task, input),
      recipients: [{ phones: [input.phone], region: config.calle.region, locale: config.calle.locale }],
      recipientResultSchema: RESULT_SCHEMA,
      metadata: { app: "tether", requestId: input.requestId },
    },
    { idempotencyKey, timeoutMs: config.calle.waitTimeoutMs },
  );
  return CallOutcome.parse({
    provider: "calle",
    mode,
    dryRun: false,
    goalRunId: null,
    callId: call.id,
    status: call.status,
    result: call.recipients[0]?.structuredResult ?? null,
    error: call.failureCode ? `${call.failureCode}: ${call.failureMessage ?? ""}` : null,
    startedAt,
    completedAt: call.completedAt,
  });
}

export const RESULT_SCHEMA = {
  type: "object",
  required: ["answer", "details", "human_required", "next_steps", "channel", "reference_number", "callback_needed"],
  additionalProperties: false,
  properties: {
    answer: { type: "string", enum: ["yes", "no", "unknown"] },
    details: { type: "string", description: "Plain summary of what the business said" },
    human_required: { type: "boolean", description: "True if the business needs the account holder or caregiver directly" },
    next_steps: { type: "string", description: "Exact steps the family must take" },
    channel: { type: "string", enum: ["mail", "email", "portal", "phone", "in_person", "unknown"] },
    reference_number: { type: "string" },
    callback_needed: { type: "boolean" },
  },
};

function oneShotTask(task: PhoneTask, input: PlaceCallInput): string {
  return [
    `Call ${task.business_name || input.contactLabel}. You are an AI assistant calling on behalf of ${task.on_behalf_of}, authorized by the family's main caregiver ${input.caregiverName}.`,
    `Goal: ${task.question}`,
    `Rules: ${task.constraints}`,
    `Collect: whether the answer is yes, no, or unknown; what the business said; whether they need the account holder or caregiver directly; the exact next steps; the channel (mail, email, portal, phone, in person); any reference number; whether a callback is needed.`,
  ].join("\n");
}

export function maskPhone(p: string): string {
  return p.length > 4 ? `${p.slice(0, 3)}***${p.slice(-2)}` : "***";
}
