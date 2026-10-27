// Turns retrieved evidence into a checked answer.
//   1. Evidence check: without enough supported records, no model is called.
//   2. Generation: Codex (strict JSON schema) or the deterministic mock composer.
//   3. Citation check: ids that weren't in the evidence are dropped; claims left without a citation are removed.
//   4. Confidence is calculated from the evidence, not taken from the model.
import { z } from "zod";
import { callStructured } from "@/lib/ai/openai/client";
import { loadOpenAIConfig, revealOpenAIKey } from "@/lib/ai/openai/config";
import { ANSWER_PROMPT_VERSION, ANSWER_SYSTEM, INVESTIGATE_EXTRA, answerSchema } from "@/lib/ai/prompts";

export interface Evidence {
  id: string; // E1, E2…
  recordId: string;
  ref: string;
  sourceSystem: string;
  recordType: string;
  evidenceKind: string;
  title: string;
  status: string | null;
  application: string | null;
  rootCause: string | null;
  resolution: string | null;
  updatedAt: Date | null;
  excerpt: string;
  similarity: number;
  matchedTerms: number;
  exactRef: boolean;
}

export interface AnswerBody {
  summary: { text: string; citations: string[] }[];
  steps: { title: string; detail: string; citations: string[] }[];
  hypotheses: { text: string; status: string; citations: string[] }[];
  warnings: { kind: "temporary-fix" | "stale" | "discussion-only" | "historical" | "conflict"; text: string }[];
}

export interface Confidence { level: "high" | "medium" | "low"; why: string; factors: string[] }

/** Thresholds calibrated on the demo set with multilingual-e5-small (related ≥ 0.83, unrelated ≤ 0.80). */
export const SUPPORT = { similarity: Number(process.env.SEARCH_MIN_SIMILARITY || 0.83), terms: 2 };

export function isSupported(e: Pick<Evidence, "similarity" | "matchedTerms" | "exactRef">): boolean {
  return e.exactRef || e.similarity >= SUPPORT.similarity || e.matchedTerms >= SUPPORT.terms;
}

/** Enough authorized evidence to answer: two supported records, or one that is approved knowledge or named exactly. */
export function hasEnoughEvidence(evidence: Evidence[]): boolean {
  const s = evidence.filter(isSupported);
  return s.length >= 2 || s.some((e) => e.evidenceKind === "approved" || e.exactRef);
}

const TEMPORARY = /\b(restart|reboot|re-?ran|retry|retried|temporar)/i;
const UNCONFIRMED = /\b(not confirmed|suspected|possibly|unknown|discussed)\b/i;

export function confirmedRootCause(e: Evidence): boolean {
  return !!e.rootCause && !UNCONFIRMED.test(e.rootCause) && /^(resolved|closed|published)$/i.test(e.status ?? "");
}

export function computeConfidence(cited: Evidence[], now = new Date()): Confidence {
  const factors: string[] = [];
  let score = Math.min(cited.length, 3);
  factors.push(`${cited.length} supporting record${cited.length === 1 ? "" : "s"}`);
  const approved = cited.filter((e) => e.evidenceKind === "approved").length;
  if (approved) { score += 2; factors.push(`${approved} approved article${approved > 1 ? "s" : ""}`); }
  const confirmed = cited.some(confirmedRootCause);
  if (confirmed) { score += 1; factors.push("a confirmed root cause"); }
  const temporary = cited.some((e) => e.evidenceKind === "historical" && TEMPORARY.test(e.resolution ?? "") && !confirmedRootCause(e));
  if (temporary) { score -= 1; factors.push("past fixes were temporary"); }
  const newest = Math.max(0, ...cited.map((e) => e.updatedAt?.getTime() ?? 0));
  if (newest && now.getTime() - newest > 548 * 864e5) { score -= 1; factors.push("evidence older than 18 months"); }
  const level = score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  const why = level === "high"
    ? "Approved knowledge and consistent records support this answer."
    : !confirmed && cited.length > 1
      ? "Multiple records describe similar symptoms, but the available evidence does not confirm a permanent root cause."
      : level === "medium" ? "The evidence supports this answer, but none of it is approved knowledge." : "Only a little evidence supports this answer. Treat it as a starting point.";
  return { level, why, factors };
}

export function warningsFor(cited: Evidence[]): AnswerBody["warnings"] {
  const w: AnswerBody["warnings"] = [];
  if (cited.some((e) => e.evidenceKind === "historical" && TEMPORARY.test(e.resolution ?? "") && !confirmedRootCause(e))) {
    w.push({ kind: "temporary-fix", text: "Restarting the server or service appears to provide temporary recovery. Do not present restart as the permanent resolution unless the underlying cause has been validated." });
  }
  if (cited.length && cited.every((e) => e.evidenceKind === "discussion")) w.push({ kind: "discussion-only", text: "All supporting evidence comes from email or chat discussions, which have not been validated." });
  if (cited.some((e) => e.evidenceKind === "historical") && !cited.some((e) => e.evidenceKind === "approved")) {
    w.push({ kind: "historical", text: "This resolution is historical and has not been approved as reusable knowledge. Validate before applying." });
  }
  return w;
}

/** Keeps only citations that point at real evidence, and drops claims left without one. */
export function enforceCitations(body: Omit<AnswerBody, "warnings">, evidence: Evidence[]): Omit<AnswerBody, "warnings"> {
  const ids = new Set(evidence.map((e) => e.id));
  const clean = <T extends { citations: string[] }>(xs: T[]) => xs.map((x) => ({ ...x, citations: [...new Set(x.citations.map((c) => c.trim().toUpperCase()).filter((c) => ids.has(c)))] })).filter((x) => x.citations.length > 0);
  return { summary: clean(body.summary), steps: clean(body.steps).slice(0, 7), hypotheses: clean(body.hypotheses).slice(0, 4) };
}

const modelOutput = z.object({
  insufficient: z.boolean(),
  summary: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
  steps: z.array(z.object({ title: z.string(), detail: z.string(), citations: z.array(z.string()) })),
  hypotheses: z.array(z.object({ text: z.string(), status: z.string(), citations: z.array(z.string()) })),
});

function evidenceBlock(evidence: Evidence[]): string {
  return evidence.map((e) => [
    `[${e.id}] ${e.ref} · ${e.sourceSystem} · ${e.recordType} · ${e.evidenceKind}${e.status ? ` · ${e.status}` : ""}${e.updatedAt ? ` · updated ${e.updatedAt.toISOString().slice(0, 10)}` : ""}`,
    `Title: ${e.title}`,
    e.rootCause ? `Root cause: ${e.rootCause}` : "",
    e.resolution ? `Resolution: ${e.resolution}` : "",
    `Excerpt: ${e.excerpt}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export type AiProvider = "openai" | "mock";

/** Which provider runs now. External AI needs both the setting and the data-processing approval reference. */
export function activeProvider(): { provider: AiProvider; note: string | null } {
  if (process.env.AI_PROVIDER !== "openai") return { provider: "mock", note: "Composed from the evidence without AI (AI_PROVIDER=mock). Switch on Codex for written answers." };
  try {
    const cfg = loadOpenAIConfig();
    if (!cfg.approvalRef) return { provider: "mock", note: "External AI is off until AI_DATA_PROCESSING_APPROVAL_REF is set. This answer was composed without AI." };
    revealOpenAIKey(); // a missing key would otherwise only surface as a failed call

    return { provider: "openai", note: null };
  } catch (e) {
    return { provider: "mock", note: `The AI provider isn't configured (${e instanceof Error ? e.message : "unknown"}). This answer was composed without AI.` };
  }
}

export interface Generated { body: Omit<AnswerBody, "warnings">; insufficient: boolean; modelId: string | null; inputTokens: number | null; outputTokens: number | null }

export async function generate(question: string, evidence: Evidence[], investigate: boolean, provider: AiProvider): Promise<Generated> {
  if (provider === "mock") return { ...composeWithoutAi(question, evidence, investigate), modelId: null, inputTokens: null, outputTokens: null };
  const r = await callStructured({
    schemaName: "synora_answer",
    jsonSchema: answerSchema(investigate),
    system: investigate ? `${ANSWER_SYSTEM}\n${INVESTIGATE_EXTRA}` : ANSWER_SYSTEM,
    user: `Question: ${question}\n\nEvidence:\n${evidenceBlock(evidence)}`,
    parse: (raw) => modelOutput.parse(raw),
  });
  return { body: { summary: r.value.summary, steps: r.value.steps, hypotheses: r.value.hypotheses }, insufficient: r.value.insufficient, modelId: r.modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
}

const firstSentences = (s: string, n = 2) => (s.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [s]).slice(0, n).join(" ").trim();

/**
 * Deterministic answer without AI: extracts from the best evidence. Used when external AI is off,
 * so the product stays useful and honest (it says the answer was composed without AI).
 */
export function composeWithoutAi(_question: string, evidence: Evidence[], investigate: boolean): { body: Omit<AnswerBody, "warnings">; insufficient: boolean } {
  const supported = evidence.filter(isSupported).slice(0, 5);
  const lead = supported.find((e) => e.evidenceKind === "approved") ?? supported[0];
  if (!lead) return { body: { summary: [], steps: [], hypotheses: [] }, insufficient: true };
  const similar = supported.filter((e) => e !== lead && e.evidenceKind !== "approved");
  const temporary = supported.filter((e) => e.evidenceKind === "historical" && TEMPORARY.test(e.resolution ?? "") && !confirmedRootCause(e));
  const summary = [{
    text: lead.evidenceKind === "approved"
      ? `Approved guidance in ${lead.ref} covers this: ${firstSentences(lead.resolution ?? lead.excerpt.replace(lead.title, ""), 1)}`
      : `${lead.ref} describes the same pattern: ${lead.title}.`,
    citations: [lead.id],
  }];
  if (similar.length) summary.push({ text: `${similar.length} related record${similar.length > 1 ? "s describe" : " describes"} similar symptoms (${similar.slice(0, 3).map((e) => e.ref).join(", ")}).`, citations: similar.slice(0, 3).map((e) => e.id) });
  if (temporary.length) summary.push({ text: "In those cases a restart or retry only restored service for a while, so the underlying cause is probably still present.", citations: temporary.map((e) => e.id) });

  // Steps never repeat a temporary fix or a discussion's action as a recommendation.
  const steps: { title: string; detail: string; citations: string[] }[] = [];
  for (const e of supported) {
    if (e.evidenceKind === "approved" && e.resolution) steps.push({ title: firstSentences(e.resolution, 1), detail: `Approved guidance (${e.ref}).`, citations: [e.id] });
    else if (e.evidenceKind === "historical" && confirmedRootCause(e) && e.resolution) steps.push({ title: `Check whether the earlier cause applies: ${e.rootCause!.replace(/\.$/, "")}.`, detail: `Fixed then by: ${firstSentences(e.resolution, 1)} (${e.ref})`, citations: [e.id] });
    else if (e.rootCause && UNCONFIRMED.test(e.rootCause)) {
      const cause = e.rootCause.replace(/^(suspected|not confirmed|discussed)[^a-z]*/i, "").replace(/^(not confirmed|discussed)[.,]?\s*/i, "").replace(/engineer note:\s*/i, "").replace(/["“”]/g, "").replace(/\.$/, "").trim();
      if (cause.length >= 12 && !/^(not confirmed|discussed)/i.test(cause)) steps.push({ title: `Check the suspected cause: ${cause}.`, detail: `Suspected in ${e.ref}, not confirmed.`, citations: [e.id] });
    }
    else if (e.evidenceKind === "reference" && e.resolution) steps.push({ title: firstSentences(e.resolution, 1), detail: `From the reference document ${e.ref}.`, citations: [e.id] });
    else if (e.evidenceKind === "dev_work") steps.push({ title: `Follow ${e.ref}: ${e.title}.`, detail: e.status ? `Status: ${e.status}.` : "", citations: [e.id] });
  }
  steps.sort((a, b) => Number(b.detail.startsWith("Approved")) - Number(a.detail.startsWith("Approved")));
  const seen = new Set<string>();
  steps.splice(0, steps.length, ...steps.filter((s) => (seen.has(s.title.toLowerCase()) ? false : (seen.add(s.title.toLowerCase()), true))).slice(0, 6));
  const hypotheses = investigate
    ? supported.filter((e) => e.rootCause).map((e) => ({ text: e.rootCause!, status: confirmedRootCause(e) ? "supported" : "possible", citations: [e.id] })).slice(0, 4)
    : [];
  return { body: { summary, steps, hypotheses }, insufficient: false };
}

export { ANSWER_PROMPT_VERSION };
