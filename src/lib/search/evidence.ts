// Which retrieved hits become the evidence an answer is written from, and how each is described. Shared by the
// search pipeline and the evaluation (scripts/eval.ts), so both measure the same behaviour.
import { confirmedRootCause, isSupported, TEMPORARY } from "./answer";
import type { Hit } from "./retrieve";

export const EVIDENCE_LIMIT = 8;
/** Extra places for sources not yet represented, so one large source can't crowd out the others. */
export const EXTRA_SOURCE_SLOTS = 3;

/** The source a record is filtered and grouped under. Demonstration records are always their own group. */
export type SourceGroup = "hda" | "ado" | "ado-wiki" | "sharepoint" | "onedrive" | "demo" | "other";
export const SOURCE_GROUP_LABEL: Record<SourceGroup, string> = {
  hda: "HDA", ado: "Azure DevOps", "ado-wiki": "Azure DevOps Wiki", sharepoint: "SharePoint", onedrive: "OneDrive", demo: "Demonstration data", other: "Other",
};
export function sourceGroup(r: { sourceSystem: string; demo?: boolean }): SourceGroup {
  if (r.demo) return "demo";
  return ({ "HDA Ticketing": "hda", "Azure DevOps": "ado", "Azure DevOps Wiki": "ado-wiki", SharePoint: "sharepoint", OneDrive: "onedrive" } as Record<string, SourceGroup>)[r.sourceSystem] ?? "other";
}

/**
 * The hits, best first, that are sent to the answer step: the strongest EVIDENCE_LIMIT, plus the best supported
 * hit of each source that isn't represented yet. Order stays by retrieval score, so a weaker source never jumps
 * ahead of stronger evidence; it only gets a place.
 */
export function selectEvidence(hits: Hit[], groupOf: (recordId: string) => string): Hit[] {
  const chosen = hits.slice(0, EVIDENCE_LIMIT);
  const present = new Set(chosen.filter(isSupported).map((h) => groupOf(h.recordId)));
  const extra: Hit[] = [];
  for (const h of hits.slice(EVIDENCE_LIMIT)) {
    if (extra.length >= EXTRA_SOURCE_SLOTS) break;
    const g = groupOf(h.recordId);
    if (!present.has(g) && isSupported(h)) { extra.push(h); present.add(g); }
  }
  return [...chosen, ...extra].sort((a, b) => hits.indexOf(a) - hits.indexOf(b));
}

/** How strongly retrieval matched a record. This is retrieval relevance, not the chance the answer is right. */
export type Relevance = "exact" | "strong" | "related" | "weak";
export function relevanceOf(h: Pick<Hit, "exactRef" | "similarity" | "matchedTerms">): Relevance {
  if (h.exactRef) return "exact";
  if (h.similarity >= 0.88 || (h.similarity >= 0.85 && h.matchedTerms >= 2) || h.matchedTerms >= 4) return "strong";
  return isSupported(h) ? "related" : "weak";
}

/**
 * The part a record plays in the answer, from its metadata only (no guessing):
 *   confirmed-resolution  closed/resolved with a recorded, unhedged root cause
 *   temporary-workaround  historical record whose fix was a restart/retry and whose cause isn't confirmed
 *   authoritative-doc     approved knowledge
 *   documentation         reference documents (SharePoint, OneDrive, wiki) not marked approved
 *   investigation         development work that is still open
 *   development-work      development work that is closed
 *   similar-incident      other historical tickets
 *   direct                named exactly in the question
 *   background            matched, but too weakly to support the answer
 */
export type EvidenceRole = "direct" | "confirmed-resolution" | "temporary-workaround" | "authoritative-doc" | "documentation" | "investigation" | "development-work" | "similar-incident" | "background";
export const ROLE_LABEL: Record<EvidenceRole, string> = {
  direct: "Named in your question", "confirmed-resolution": "Confirmed resolution", "temporary-workaround": "Temporary recovery only",
  "authoritative-doc": "Approved documentation", documentation: "Documentation", investigation: "Investigation in progress",
  "development-work": "Development work", "similar-incident": "Similar historical incident", background: "Background context",
};
const CLOSED_WORK = /^(closed|done|resolved|removed|completed)$/i;
export function roleOf(h: Pick<Hit, "exactRef" | "similarity" | "matchedTerms">, r: { evidenceKind: string; status: string | null; rootCause: string | null; resolution: string | null }): EvidenceRole {
  if (h.exactRef) return "direct";
  if (!isSupported(h)) return "background";
  const e = { ...r, id: "", recordId: "", ref: "", sourceSystem: "", recordType: "", title: "", application: null, updatedAt: null, excerpt: "", ...h };
  if (r.evidenceKind === "approved") return "authoritative-doc";
  if (r.evidenceKind === "reference") return "documentation";
  if (r.evidenceKind === "dev_work") return CLOSED_WORK.test(r.status ?? "") ? "development-work" : "investigation";
  if (confirmedRootCause(e)) return "confirmed-resolution";
  if (r.evidenceKind === "historical" && TEMPORARY.test(r.resolution ?? "")) return "temporary-workaround";
  return "similar-incident";
}

/** The part of a chunk that best matches the question's words: a ~320 character window, cut at word boundaries. */
export function focusExcerpt(text: string, terms: string[], size = 320): string {
  // Markdown and table markup from wiki pages and documents is noise in a short excerpt.
  const clean = text.replace(/\*\*|__|`+|^#+\s|\s\|\s|\|/gm, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  if (clean.length <= size || !terms.length) return clean.slice(0, size);
  const lower = clean.toLowerCase();
  let best = 0, bestHits = -1;
  for (let start = 0; start < clean.length - size / 2; start += 40) {
    const win = lower.slice(start, start + size);
    const hits = terms.reduce((n, t) => n + (win.includes(t) ? 1 : 0), 0);
    if (hits > bestHits) { bestHits = hits; best = start; }
  }
  const from = best === 0 ? 0 : clean.indexOf(" ", best) + 1;
  const to = clean.lastIndexOf(" ", from + size);
  return `${from > 0 ? "…" : ""}${clean.slice(from, to > from ? to : from + size)}${to < clean.length ? "…" : ""}`;
}
