# Tether safety pattern: proxy phone agency for a family member

Tether lets an AI place calls *on behalf of* a person who is present, competent, and simply not comfortable doing phone work in English. That is a different risk profile from calling the person themselves, and it overlaps with elder financial abuse if done carelessly. These six rules are enforced in code (`src/safety.ts`, `src/service.ts`), not in prompts.

1. **No credentials, ever.** There is no field for passwords, logins, account numbers, or one-time codes. The agent is told in every task that it must never provide or confirm identifiers, and the fallback when a business demands verification is to ask *what* is needed and end the call. Tether never moves money.
2. **A named caregiver approves every call.** The loved one's button creates a request; only a `caregiver` role can approve, and the approval records who and when. Supporters can see, not dial.
3. **Numbers come from the family's allowlist only.** `data/contacts.json` is typed in by the family. A phone number spoken into the mic is treated as text, never as a dial target. This closes the "call this number and give them my details" scam vector.
4. **Hard constraints are appended in code.** `withHardConstraints` adds the no-pay, no-commit, no-identifier rules to every task after any caregiver edits, so neither a model nor a UI can drop them.
5. **Models see shapes, not values.** Digit runs are redacted before any text reaches a model. The triage model receives catalog *slot names* and returns templates like `Your checking account has {{mom.checking.balance}}`; the device fills the number locally.
6. **The person concerned always sees what was done in their name.** Visibility rules let the loved one read the transcript, result, and audit trail of any request about their own accounts, regardless of who approved it. Caregiver actions are never invisible to the parent.

Related patterns in this repository: `holdfor`'s Release (a bounded human grant between two calls) and `dollar-consent-first-callback` (a call can never itself be the authorization channel). Tether adopts both: approval happens in the app, never on a call.
