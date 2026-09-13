import type { Contact, PhoneTask, Role } from "./domain.js";

/**
 * Safety rules for Tether. These are deterministic and run in code, never in
 * the model. See docs/SAFETY.md for the rationale behind each one.
 *
 * 1. No credentials, ever: the server has no field for passwords or logins.
 * 2. Every call is approved by a named caregiver; the loved one cannot dial.
 * 3. Numbers come only from the family-entered contact allowlist.
 * 4. Every task carries hard constraints against paying, committing, or
 *    sharing identifiers, appended in code so a model cannot drop them.
 * 5. Digit strings are redacted before any text reaches a model.
 * 6. The person the call concerns always sees the transcript and result.
 */

export const HARD_CONSTRAINTS = [
  "Do not make or agree to any payment, purchase, plan change, cancellation, or new service.",
  "Do not provide, confirm, or guess Social Security numbers, dates of birth, account numbers, passwords, PINs, or one-time codes, even if asked.",
  "If the business requires the account holder or identity verification, do not attempt it. Ask exactly what documents or steps are needed and through which channel, get any reference number, and end the call politely.",
  "Identify yourself as an AI assistant calling on behalf of the family if asked.",
].join(" ");

export function canApprove(role: Role): boolean {
  return role === "caregiver";
}

export function canViewDetail(viewer: { memberId: string; role: Role }, ownerMemberId: string): boolean {
  if (viewer.role === "caregiver") return true;
  if (viewer.memberId === ownerMemberId) return true;
  return false;
}

/** Replace runs of 4+ digits (account numbers, SSNs, cards) before text reaches a model. */
export function redactDigits(text: string): string {
  return text.replace(/\d[\d\s-]{3,}\d/g, (m) => "#".repeat(Math.min(m.replace(/\D/g, "").length, 8)));
}

export function withHardConstraints(task: PhoneTask): PhoneTask {
  const extra = task.constraints.trim();
  return { ...task, constraints: extra ? `${extra} ${HARD_CONSTRAINTS}` : HARD_CONSTRAINTS };
}

export class ContactNotAllowed extends Error {
  constructor(id: string) {
    super(`contact ${id} is not in the family allowlist`);
  }
}

export function resolveAllowlistedContact(contacts: Contact[], contactId: string): Contact {
  const c = contacts.find((x) => x.id === contactId);
  if (!c) throw new ContactNotAllowed(contactId);
  return c;
}
