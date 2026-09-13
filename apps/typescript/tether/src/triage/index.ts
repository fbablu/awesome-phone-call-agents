import { GoogleGenAI, Type } from "@google/genai";
import { config } from "../config.js";
import { Triage, type CatalogEntry, type TriageKind } from "../domain.js";
import { redactDigits } from "../safety.js";

export interface TriageInput {
  transcript: string;
  memberName: string;
  catalog: CatalogEntry[];
  contacts: { id: string; label: string; category: string }[];
}

export type Triager = (input: TriageInput) => Promise<Triage>;

export function makeTriager(provider = config.triage.provider): Triager {
  switch (provider) {
    case "gemini":
      return triageWithGemini;
    case "fixture":
      return triageFixture;
    default:
      throw new Error(`unknown triage provider ${provider}`);
  }
}

const SYSTEM = `You are Tether, an assistant for an immigrant family. A family member (often an older parent) pressed a button and spoke in Bengali, English, or a mix. Your job is to TRIAGE, not to act.

Decide exactly one kind:
- answer_from_data: the question can be answered from the family's own records listed in the catalog. Write an answer TEMPLATE using {{slot}} placeholders from the catalog. NEVER write a number, amount, or date yourself; the device fills the slots.
- general_answer: a general-knowledge question with no personal data and no action needed. Give the short answer in the template fields.
- phone_task: somebody needs to call a business (insurer, bank, clinic, pharmacy, landlord/tenant, utility). Fill phone_task. Pick business_name from the family's contact list when one matches; otherwise name the business as spoken. Write question as the exact thing to find out or request, in English, in one or two sentences. Put anything the caller must not do in constraints.
- clarify: the request is too vague to act on. summary_en says what is missing.

Always fill summary_en (one plain English line, like a phone notification) and readback_bn (one short, warm Bengali sentence confirming what Tether understood, e.g. "বুঝেছি — আপনার ব্লাড প্রেশারের ওষুধ refill করার জন্য pharmacy-তে ফোন করা হবে।"). steps is for the caregiver: what a human should do if the agent cannot. Keep every field short.`;

const schema = {
  type: Type.OBJECT,
  properties: {
    kind: { type: Type.STRING, enum: ["answer_from_data", "general_answer", "phone_task", "clarify"] },
    summary_en: { type: Type.STRING },
    readback_bn: { type: Type.STRING },
    answer_template_en: { type: Type.STRING },
    answer_template_bn: { type: Type.STRING },
    slots_used: { type: Type.ARRAY, items: { type: Type.STRING } },
    steps: { type: Type.ARRAY, items: { type: Type.STRING } },
    urgency: { type: Type.STRING, enum: ["low", "normal", "high"] },
    phone_task: {
      type: Type.OBJECT,
      properties: {
        business_name: { type: Type.STRING },
        question: { type: Type.STRING },
        constraints: { type: Type.STRING },
        on_behalf_of: { type: Type.STRING },
      },
      required: ["business_name", "question", "constraints", "on_behalf_of"],
    },
  },
  required: ["kind", "summary_en", "readback_bn", "slots_used", "steps", "urgency"],
};

export async function triageWithGemini(input: TriageInput): Promise<Triage> {
  if (!config.geminiApiKey) throw new Error("TETHER_GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const user = [
    `Speaker: ${input.memberName}`,
    `Transcript: ${redactDigits(input.transcript)}`,
    `Catalog (slots the device can fill; values are NOT available to you):`,
    ...input.catalog.map((c) => `- {{${c.slot}}}: ${c.owner}'s ${c.label} (${c.kind})`),
    `Known contacts the family has approved for calls:`,
    ...input.contacts.map((c) => `- ${c.label} (${c.category})`),
  ].join("\n");
  const res = await ai.models.generateContent({
    model: config.triage.geminiModel,
    contents: [{ role: "user", parts: [{ text: user }] }],
    config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
  });
  const parsed = Triage.parse(JSON.parse(res.text ?? "{}"));
  return postValidate(parsed, input);
}

/** Enforce invariants no matter what the model did. */
export function postValidate(t: Triage, input: TriageInput): Triage {
  const out: Triage = { ...t };
  const digits = /\d/;
  if (out.answer_template_en && digits.test(out.answer_template_en)) out.answer_template_en = out.answer_template_en.replace(/\d[\d,.]*/g, "[?]");
  if (out.answer_template_bn && digits.test(out.answer_template_bn)) out.answer_template_bn = out.answer_template_bn.replace(/\d[\d,.]*/g, "[?]");
  const known = new Set(input.catalog.map((c) => c.slot));
  out.slots_used = out.slots_used.filter((s) => known.has(s));
  if (out.kind === "answer_from_data" && out.slots_used.length === 0) out.kind = "clarify";
  if (out.kind === "phone_task" && !out.phone_task) out.kind = "clarify";
  if (out.phone_task) out.phone_task.on_behalf_of ||= input.memberName;
  return out;
}

/** Keyword triage for tests and keyless demos. Deliberately dumb and deterministic. */
export async function triageFixture(input: TriageInput): Promise<Triage> {
  const t = input.transcript.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const bn = (s: string) => s;
  let kind: TriageKind = "clarify";
  const base = { summary_en: "", readback_bn: "", slots_used: [] as string[], steps: [] as string[], urgency: "normal" as const };

  if (has("কত টাকা", "কত আছে", "how much", "balance")) {
    const slot = input.catalog.find((c) => c.kind === "balance");
    if (slot) {
      return postValidate(
        {
          ...base,
          kind: "answer_from_data",
          summary_en: `${input.memberName} asked for the ${slot.label} balance`,
          readback_bn: bn("আপনার অ্যাকাউন্টে কত আছে, সেটা এখনই দেখাচ্ছি।"),
          answer_template_en: `Your ${slot.label} has {{${slot.slot}}}.`,
          answer_template_bn: `আপনার ${slot.label}-এ আছে {{${slot.slot}}}।`,
          slots_used: [slot.slot],
        },
        input,
      );
    }
  }
  if (has("insurance", "cover", "ইন্স্যুরেন্স", "refill", "pharmacy", "bank", "bill", "tenant", "ভাড়া", "loan", "cenlar", "paid in full")) {
    kind = "phone_task";
    const contact = input.contacts.find((c) => t.includes(c.label.toLowerCase().split(" ")[0]));
    return postValidate(
      {
        ...base,
        kind,
        summary_en: `${input.memberName} needs a call made: ${input.transcript.slice(0, 80)}`,
        readback_bn: bn("বুঝেছি, এই কাজটার জন্য ফোন করা হবে। আগে অনুমোদন নেওয়া হবে।"),
        steps: ["Confirm which business and account this concerns", "Approve the call or handle it yourself"],
        phone_task: {
          business_name: contact?.label ?? "the business mentioned",
          question: input.transcript,
          constraints: "",
          on_behalf_of: input.memberName,
        },
      },
      input,
    );
  }
  return postValidate(
    { ...base, kind, summary_en: `Could not tell what ${input.memberName} needs`, readback_bn: bn("দুঃখিত, একটু বুঝতে পারিনি। আবার বলবেন?") },
    input,
  );
}
