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
  /** The team's investigation notes (Azure DevOps Analysis): what was checked and found. Not a confirmed cause by itself. */
  analysis?: string | null;
  updatedAt: Date | null;
  excerpt: string;
  similarity: number;
  matchedTerms: number;
  termCount?: number;
  exactRef: boolean;
}

export type AnswerFormat = "troubleshooting" | "factual" | "comparison" | "summary";
export interface AnswerBody {
  format: AnswerFormat;
  heading: string;
  /** The direct answer. Every sentence cites the records that state it. */
  summary: { text: string; citations: string[] }[];
  /** How the affected application or process works, from documentation (wiki pages, documents). Always cited. */
  background: { text: string; citations: string[] }[];
  /** documented and pattern items cite their records; a hypothesis is an interpretation and may cite none. */
  explanation: { text: string; status: "documented" | "pattern" | "hypothesis"; citations: string[] }[];
  /** documented steps cite the record describing them; recommended ones are Synora's suggestion. */
  steps: { title: string; detail: string; basis: "documented" | "recommended"; citations: string[] }[];
  hypotheses: { text: string; status: string; citations: string[] }[];
  unknowns: string[];
  validation: string[];
  followUps: string[];
  clarification: string | null;
  warnings: { kind: "temporary-fix" | "stale" | "discussion-only" | "historical" | "conflict"; text: string }[];
}
type Draft = Omit<AnswerBody, "warnings">;

export interface Confidence { level: "high" | "medium" | "low"; why: string; factors: string[] }

/**
 * When a record supports an answer. multilingual-e5-small scores almost any text 0.77–0.85 against a question, so
 * similarity alone at 0.83 let unrelated questions through ("cafeteria menu" matched tickets). Measured on the
 * evaluation set (npm run eval): out-of-scope questions peak at 0.77–0.85 with 1–3 common words matched; real ones
 * at 0.86–0.95. So a record is supported when it is named exactly, is a strong semantic match, or is a good
 * semantic match that also covers most of the question's words.
 */
export const SUPPORT = { strong: Number(process.env.SEARCH_STRONG_SIMILARITY || 0.86), similarity: Number(process.env.SEARCH_MIN_SIMILARITY || 0.83), coverage: 0.6, terms: 3 };

export function isSupported(e: Pick<Evidence, "similarity" | "matchedTerms" | "exactRef"> & { termCount?: number }): boolean {
  if (e.exactRef || e.similarity >= SUPPORT.strong) return true;
  const coverage = e.termCount ? e.matchedTerms / e.termCount : e.matchedTerms >= SUPPORT.terms ? 1 : 0;
  return coverage >= SUPPORT.coverage && (e.similarity >= SUPPORT.similarity || e.matchedTerms >= SUPPORT.terms);
}

/** Enough authorized evidence to answer: two supported records, or one that is approved knowledge or named exactly. */
export function hasEnoughEvidence(evidence: Evidence[]): boolean {
  const s = evidence.filter(isSupported);
  return s.length >= 2 || s.some((e) => e.evidenceKind === "approved" || e.exactRef);
}

export const TEMPORARY = /\b(restart|reboot|re-?ran|retry|retried|temporar)/i;
const UNCONFIRMED = /\b(not confirmed|suspected|possibly|unknown|discussed)\b/i;

/**
 * A past fix that only restored service for a while: a restart/retry recorded as the resolution of a ticket or
 * support work item whose cause isn't confirmed.
 */
export function temporaryFix(e: Pick<Evidence, "evidenceKind" | "resolution" | "rootCause" | "status">): boolean {
  return (e.evidenceKind === "historical" || e.evidenceKind === "dev_work") && TEMPORARY.test(e.resolution ?? "") && !confirmedRootCause(e as Evidence);
}

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
  const temporary = cited.some((e) => temporaryFix(e));
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
  if (cited.some((e) => temporaryFix(e))) {
    w.push({ kind: "temporary-fix", text: "Restarting the server or service appears to provide temporary recovery. Do not present restart as the permanent resolution unless the underlying cause has been validated." });
  }
  if (cited.length && cited.every((e) => e.evidenceKind === "discussion")) w.push({ kind: "discussion-only", text: "All supporting evidence comes from email or chat discussions, which have not been validated." });
  if (cited.some((e) => e.evidenceKind === "historical") && !cited.some((e) => e.evidenceKind === "approved")) {
    w.push({ kind: "historical", text: "This resolution is historical and has not been approved as reusable knowledge. Validate before applying." });
  }
  return w;
}

/** Strips evidence ids a model may leave in plain text ("[E2]"), so uncited lists don't look cited. */
const plain = (t: string) => t.replace(/\s*\[?\bE\d{1,2}\b\]?/g, "").replace(/\s+([.,;:])/g, "$1").trim();

/**
 * Keeps only citations that point at real evidence and drops claims left without one: summary sentences,
 * documented explanations and patterns. A documented step that lost its citations is kept as a recommendation,
 * so it is never shown as if a source described it. Hypotheses and recommendations stay, labelled as such.
 */
export function enforceCitations(body: Draft, evidence: Evidence[]): Draft {
  const ids = new Set(evidence.map((e) => e.id));
  const valid = (cs: string[]) => [...new Set(cs.map((c) => c.trim().toUpperCase()).filter((c) => ids.has(c)))];
  const cited = <T extends { citations: string[] }>(xs: T[]) => xs.map((x) => ({ ...x, citations: valid(x.citations) }));
  const short = (xs: string[], n: number) => [...new Set(xs.map(plain).filter((x) => x.length > 3))].slice(0, n);
  return {
    format: body.format,
    heading: plain(body.heading).slice(0, 120),
    summary: cited(body.summary).filter((x) => x.citations.length > 0),
    background: cited(body.background ?? []).filter((x) => x.citations.length > 0).slice(0, 3),
    explanation: cited(body.explanation).filter((x) => x.status === "hypothesis" || x.citations.length > 0).slice(0, 4),
    steps: cited(body.steps).map((x) => (x.basis === "documented" && !x.citations.length ? { ...x, basis: "recommended" as const } : x)).slice(0, 6),
    hypotheses: cited(body.hypotheses).filter((x) => x.citations.length > 0).slice(0, 4),
    unknowns: short(body.unknowns, 5), validation: short(body.validation, 4), followUps: short(body.followUps, 4),
    clarification: body.clarification ? plain(body.clarification) || null : null,
  };
}

const modelOutput = z.object({
  insufficient: z.boolean(),
  format: z.enum(["troubleshooting", "factual", "comparison", "summary"]),
  heading: z.string(),
  summary: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
  background: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
  explanation: z.array(z.object({ text: z.string(), status: z.enum(["documented", "pattern", "hypothesis"]), citations: z.array(z.string()) })),
  steps: z.array(z.object({ title: z.string(), detail: z.string(), basis: z.enum(["documented", "recommended"]), citations: z.array(z.string()) })),
  hypotheses: z.array(z.object({ text: z.string(), status: z.string(), citations: z.array(z.string()) })),
  unknowns: z.array(z.string()), validation: z.array(z.string()), followUps: z.array(z.string()),
  clarification: z.string(),
});

/** The evidence as the model sees it. Record text sits between markers and is declared untrusted in the prompt. */
export function evidenceBlock(evidence: Evidence[]): string {
  const safe = (t: string) => t.replace(/<\/?record[^>]*>/gi, "");
  return evidence.map((e) => [
    `<record id="${e.id}">`,
    `${e.ref} · ${e.sourceSystem} · ${e.recordType} · ${e.evidenceKind}${e.status ? ` · ${e.status}` : ""}${e.updatedAt ? ` · updated ${e.updatedAt.toISOString().slice(0, 10)}` : ""}`,
    `Title: ${safe(e.title)}`,
    e.rootCause ? `Root cause: ${safe(e.rootCause)}` : "",
    e.analysis ? `Analysis (the team's investigation notes): ${safe(e.analysis).slice(0, 1500)}` : "",
    e.resolution ? `Resolution: ${safe(e.resolution)}` : "",
    `Excerpt: ${safe(e.excerpt)}`,
    "</record>",
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

export interface Generated { body: Draft; insufficient: boolean; modelId: string | null; inputTokens: number | null; outputTokens: number | null }

export async function generate(question: string, evidence: Evidence[], investigate: boolean, provider: AiProvider): Promise<Generated> {
  if (provider === "mock") return { ...composeWithoutAi(question, evidence, investigate), modelId: null, inputTokens: null, outputTokens: null };
  const r = await callStructured({
    schemaName: "synora_answer",
    jsonSchema: answerSchema(investigate),
    system: investigate ? `${ANSWER_SYSTEM}\n${INVESTIGATE_EXTRA}` : ANSWER_SYSTEM,
    user: `Question: ${question}\n\nEvidence:\n${evidenceBlock(evidence)}`,
    parse: (raw) => modelOutput.parse(raw),
  });
  const { insufficient, clarification, ...rest } = r.value;
  return { body: { ...rest, clarification: clarification.trim() || null }, insufficient, modelId: r.modelId, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
}

const firstSentences = (s: string, n = 2) => (s.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [s]).slice(0, n).join(" ").trim();

/**
 * Deterministic answer without AI: extracts from the best evidence. Used when external AI is off,
 * so the product stays useful and honest (it says the answer was composed without AI).
 */
export function composeWithoutAi(_question: string, evidence: Evidence[], investigate: boolean): { body: Draft; insufficient: boolean } {
  const supported = evidence.filter(isSupported).slice(0, 5);
  const lead = supported.find((e) => e.evidenceKind === "approved") ?? supported[0];
  if (!lead) return { body: { format: "summary", heading: "", summary: [], background: [], explanation: [], steps: [], hypotheses: [], unknowns: [], validation: [], followUps: [], clarification: null }, insufficient: true };
  const similar = supported.filter((e) => e !== lead && e.evidenceKind !== "approved");
  const temporary = supported.filter((e) => temporaryFix(e));
  const summary = [{
    text: lead.evidenceKind === "approved"
      ? `Approved guidance in ${lead.ref} covers this: ${firstSentences(lead.resolution ?? lead.excerpt.replace(lead.title, ""), 1)}`
      : `${lead.ref} describes the same pattern: ${lead.title}.`,
    citations: [lead.id],
  }];
  if (similar.length) summary.push({ text: `${similar.length} related record${similar.length > 1 ? "s describe" : " describes"} similar symptoms (${similar.slice(0, 3).map((e) => e.ref).join(", ")}).`, citations: similar.slice(0, 3).map((e) => e.id) });
  if (temporary.length) summary.push({ text: "In those cases a restart or retry only restored service for a while, so the underlying cause is probably still present.", citations: temporary.map((e) => e.id) });

  // Steps never repeat a temporary fix or a discussion's action as a recommendation.
  const steps: Draft["steps"] = [];
  for (const e of supported) {
    if (e.evidenceKind === "approved" && e.resolution) steps.push({ title: firstSentences(e.resolution, 1), detail: `Approved guidance (${e.ref}).`, basis: "documented", citations: [e.id] });
    else if (e.evidenceKind === "historical" && confirmedRootCause(e) && e.resolution) steps.push({ title: `Check whether the earlier cause applies: ${e.rootCause!.replace(/\.$/, "")}.`, detail: `Fixed then by: ${firstSentences(e.resolution, 1)} (${e.ref})`, basis: "documented", citations: [e.id] });
    else if (e.rootCause && UNCONFIRMED.test(e.rootCause)) {
      const cause = e.rootCause.replace(/^(suspected|not confirmed|discussed)[^a-z]*/i, "").replace(/^(not confirmed|discussed)[.,]?\s*/i, "").replace(/engineer note:\s*/i, "").replace(/["“”]/g, "").replace(/\.$/, "").trim();
      if (cause.length >= 12 && !/^(not confirmed|discussed)/i.test(cause)) steps.push({ title: `Check the suspected cause: ${cause}.`, detail: `Suspected in ${e.ref}, not confirmed.`, basis: "documented", citations: [e.id] });
    }
    else if (e.evidenceKind === "reference" && e.resolution) steps.push({ title: firstSentences(e.resolution, 1), detail: `From the reference document ${e.ref}.`, basis: "documented", citations: [e.id] });
    else if (e.evidenceKind === "dev_work") steps.push({ title: `Follow ${e.ref}: ${e.title}.`, detail: e.status ? `Status: ${e.status}.` : "", basis: "documented", citations: [e.id] });
  }
  steps.sort((a, b) => Number(b.detail.startsWith("Approved")) - Number(a.detail.startsWith("Approved")));
  const seen = new Set<string>();
  steps.splice(0, steps.length, ...steps.filter((s) => (seen.has(s.title.toLowerCase()) ? false : (seen.add(s.title.toLowerCase()), true))).slice(0, 6));
  const hypotheses = investigate
    ? supported.filter((e) => e.rootCause).map((e) => ({ text: e.rootCause!, status: confirmedRootCause(e) ? "supported" : "possible", citations: [e.id] })).slice(0, 4)
    : [];
  // Without AI, explanation, gaps and follow-ups come only from what the metadata establishes.
  const confirmed = supported.filter(confirmedRootCause);
  const explanation: Draft["explanation"] = [];
  if (temporary.length) explanation.push({ text: `In ${temporary.length} record${temporary.length > 1 ? "s" : ""} a restart or retry restored service, but no permanent cause was recorded.`, status: "pattern", citations: temporary.map((e) => e.id) });
  for (const e of confirmed.slice(0, 2)) explanation.push({ text: `${e.ref} records the cause: ${e.rootCause!.replace(/\.$/, "")}.`, status: "documented", citations: [e.id] });
  const unknowns = [
    ...(confirmed.length ? [] : ["None of the matching records confirms the root cause."]),
    ...(supported.some((e) => e.evidenceKind === "approved") ? [] : ["No approved knowledge covers this; the records are historical or reference material."]),
  ];
  const validation = temporary.length ? ["After a fix, check the problem doesn't return over a period longer than the earlier recoveries lasted."] : [];
  const apps = [...new Set(supported.map((e) => e.application).filter((a): a is string => !!a))];
  const followUps = [
    ...(confirmed[0] ? [`What fixed ${confirmed[0].ref}?`] : []),
    ...(apps[0] ? [`Is there approved guidance for ${apps[0]}?`] : []),
    `Show incidents similar to ${lead.ref}`,
  ].slice(0, 4);
  const format: AnswerFormat = temporary.length || confirmed.length || investigate ? "troubleshooting" : "summary";
  const heading = lead.evidenceKind === "approved" ? `Approved guidance: ${lead.title}` : temporary.length && !confirmed.length ? "Temporary recovery seen; root cause not confirmed" : lead.title;
  // Functional background: the opening of the most relevant documentation record, cited.
  const background = evidence.filter((e) => e.evidenceKind === "reference" || e.evidenceKind === "approved").slice(0, 1)
    .map((e) => ({ text: `${e.title}: ${firstSentences(e.excerpt.replace(/^Wiki page [^\n]*\n+/, ""), 2)}`, citations: [e.id] }));
  return { body: { format, heading: heading.slice(0, 120), summary, background, explanation, steps, hypotheses, unknowns, validation, followUps, clarification: null }, insufficient: false };
}

export { ANSWER_PROMPT_VERSION };
