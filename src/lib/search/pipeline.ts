// The search flow behind /api/search. Yields events the UI renders as they arrive:
//   stage → evidence (+ sources, related) → answer | insufficient | records | similar → done
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canSee } from "@/lib/access";
import type { Session } from "@/lib/auth/session";
import { parseQuery } from "./query";
import { retrieve, type Hit, type SearchFilters } from "./retrieve";
import { ANSWER_PROMPT_VERSION, activeProvider, computeConfidence, confirmedRootCause, enforceCitations, generate, hasEnoughEvidence, isSupported, TEMPORARY, warningsFor, type AnswerBody, type Confidence, type Evidence } from "./answer";
import { focusExcerpt, relevanceOf, roleOf, ROLE_LABEL, selectEvidence, SOURCE_GROUP_LABEL, sourceGroup, type EvidenceRole, type Relevance, type SourceGroup } from "./evidence";

export type SearchMode = "ask" | "records" | "similar" | "investigate";

export interface RecordCard {
  id: string; ref: string; title: string; sourceSystem: string; recordType: string; evidenceKind: string;
  status: string | null; application: string | null; location: string | null; ownerGroup: string | null; category: string | null;
  updatedAt: string | null; similarity: number; rootCause: string | null; resolution: string | null; excerpt: string;
  space: string; sensitivity: string; links: string[]; evidenceId?: string;
  /** Source group for filters ("hda", "ado", "demo"…); demonstration records are always "demo". */
  group: SourceGroup; demo: boolean; sourceUrl: string | null;
  /** Retrieval relevance (not answer correctness) and the part the record plays, both from metadata. */
  relevance: Relevance; role: EvidenceRole; roleLabel: string; rank: number;
}

/** What each source contributed to this search, so a source that wasn't searched is never implied to be. */
export interface SourceCoverage { group: SourceGroup; label: string; state: "searched" | "not-synced" | "unavailable"; indexed: number; evidence: number; connector: string | null }
export interface RelatedIssue { id: string; ref: string; title: string; sourceSystem: string; group: SourceGroup; status: string | null; updatedAt: string | null; why: string; demo: boolean }

export type SearchEvent =
  | { type: "stage"; stage: "understanding" | "searching" | "ranking" | "writing"; detail?: string }
  | { type: "evidence"; records: RecordCard[]; totalRelated: number; totalMatches: number; sources: SourceCoverage[]; related: RelatedIssue[] }
  | { type: "answer"; body: AnswerBody; confidence: Confidence; provider: string; note: string | null; trust: Trust }
  | { type: "insufficient"; reason: "no-evidence" | "filters" | "model"; records: RecordCard[]; sources: SourceCoverage[]; clarification?: string | null }
  | { type: "records"; records: RecordCard[]; sources: SourceCoverage[] }
  | { type: "similar"; records: (RecordCard & { why: string[] })[] }
  | { type: "done"; searchId: string; answerId: string | null; latencyMs: number }
  | { type: "error"; message: string };

export interface Trust {
  supporting: number; related: number; approved: number; lastEvidence: string | null; permissionAware: true; conflicting: boolean; stale: boolean;
  /** Distinct sources the cited evidence comes from. */
  sourcesUsed: number;
  /** confirmed: a cited record records an unhedged root cause; unconfirmed: none does. */
  rootCause: "confirmed" | "unconfirmed";
  /** temporary: a cited fix only restored service for a while; verified: a cited record has a confirmed resolution. */
  recovery: "temporary" | "verified" | "unknown";
}

type Rec = Prisma.SourceRecordGetPayload<{ include: { space: { select: { name: true } }; linksFrom: { include: { to: { select: { ref: true } } } }; linksTo: { include: { from: { select: { ref: true } } } } } }>;
const isDemo = (raw: unknown) => (raw as { demo?: boolean } | null)?.demo === true;

function card(h: Hit, r: Rec, rank: number, terms: string[]): RecordCard {
  const role = roleOf(h, r);
  return {
    id: r.id, ref: r.ref, title: r.title, sourceSystem: r.sourceSystem, recordType: r.recordType, evidenceKind: r.evidenceKind,
    status: r.status, application: r.application, location: r.location, ownerGroup: r.ownerGroup, category: r.category,
    updatedAt: (r.sourceUpdatedAt ?? r.indexedAt).toISOString(), similarity: Math.round(Math.max(0, Math.min(1, h.similarity)) * 100),
    rootCause: r.rootCause, resolution: r.resolution, excerpt: focusExcerpt(h.excerpt.replace(r.title, ""), terms),
    space: r.space.name, sensitivity: r.sensitivity, links: [...r.linksFrom.map((l) => l.to.ref), ...r.linksTo.map((l) => l.from.ref)],
    group: sourceGroup({ sourceSystem: r.sourceSystem, demo: isDemo(r.raw) }), demo: isDemo(r.raw), sourceUrl: isDemo(r.raw) ? null : r.sourceUrl,
    relevance: relevanceOf(h), role, roleLabel: ROLE_LABEL[role], rank,
  };
}

async function loadRecords(ids: string[]) {
  const recs = await db.sourceRecord.findMany({
    where: { id: { in: ids } },
    include: { space: { select: { name: true } }, linksFrom: { include: { to: { select: { ref: true } } } }, linksTo: { include: { from: { select: { ref: true } } } } },
  });
  return new Map(recs.map((r) => [r.id, r]));
}

const CONNECTOR_GROUPS: Record<string, SourceGroup[]> = { hda: ["hda"], ado: ["ado", "ado-wiki"], m365: ["sharepoint", "onedrive"], demo: ["demo"] };

/** Per source: whether it was searched for this person (connected and holding records they can see). */
async function coverage(principals: string[], evidence: RecordCard[]): Promise<SourceCoverage[]> {
  const [connectors, counts] = await Promise.all([
    db.connector.findMany({ select: { type: true, name: true, status: true, lastSyncAt: true } }),
    db.$queryRaw<{ sourceSystem: string; demo: boolean; n: number }[]>`
      SELECT "sourceSystem", coalesce(raw->>'demo', '') = 'true' AS demo, count(*)::int AS n FROM "SourceRecord"
      WHERE "deletedAt" IS NULL AND acl && ${principals}::text[] GROUP BY 1, 2`,
  ]);
  const indexed = new Map<SourceGroup, number>();
  for (const c of counts) { const g = sourceGroup({ sourceSystem: c.sourceSystem, demo: c.demo }); indexed.set(g, (indexed.get(g) ?? 0) + c.n); }
  const out: SourceCoverage[] = [];
  for (const c of connectors) {
    for (const g of CONNECTOR_GROUPS[c.type] ?? []) {
      const n = indexed.get(g) ?? 0;
      const state = n > 0 ? "searched" : c.lastSyncAt || c.status === "syncing" ? "not-synced" : "unavailable";
      out.push({ group: g, label: SOURCE_GROUP_LABEL[g], state, indexed: n, evidence: evidence.filter((e) => e.group === g).length, connector: c.name });
    }
  }
  return out.filter((s, i) => out.findIndex((x) => x.group === s.group) === i);
}

/** Further supported matches beyond the evidence, and records linked to the evidence, that this person can open. */
async function relatedIssues(hits: Hit[], evidenceIds: Set<string>, recs: Map<string, Rec>, principals: string[]): Promise<RelatedIssue[]> {
  const out: RelatedIssue[] = [];
  const add = (r: { id: string; ref: string; title: string; sourceSystem: string; status: string | null; sourceUpdatedAt: Date | null; indexedAt: Date; raw: unknown }, why: string) => {
    if (evidenceIds.has(r.id) || out.some((x) => x.id === r.id)) return;
    out.push({ id: r.id, ref: r.ref, title: r.title, sourceSystem: r.sourceSystem, group: sourceGroup({ sourceSystem: r.sourceSystem, demo: isDemo(r.raw) }), status: r.status, updatedAt: (r.sourceUpdatedAt ?? r.indexedAt).toISOString(), why, demo: isDemo(r.raw) });
  };
  const links = await db.recordLink.findMany({
    where: { OR: [{ fromId: { in: [...evidenceIds] } }, { toId: { in: [...evidenceIds] } }] },
    include: { from: true, to: true }, take: 40,
  });
  for (const l of links) {
    const [other, anchor] = evidenceIds.has(l.fromId) ? [l.to, l.from] : [l.from, l.to];
    if (!other.deletedAt && canSee(other.acl, principals)) add(other, `${({ parent: "Parent of", duplicate: "Duplicate of", linked: "Linked to", mentions: "Mentioned with" } as Record<string, string>)[l.kind] ?? "Linked to"} ${anchor.ref}`);
  }
  for (const h of hits) {
    const r = recs.get(h.recordId);
    if (r && isSupported(h)) add(r, relevanceOf(h) === "strong" ? "Strong match for your question" : "Also matches your question");
  }
  return out.slice(0, 12);
}

function toEvidence(h: Hit, r: Rec, i: number): Evidence {
  return { id: `E${i + 1}`, recordId: r.id, ref: r.ref, sourceSystem: isDemo(r.raw) ? `${r.sourceSystem} (demonstration data)` : r.sourceSystem, recordType: r.recordType, evidenceKind: r.evidenceKind, title: r.title, status: r.status, application: r.application, rootCause: r.rootCause, resolution: r.resolution, updatedAt: r.sourceUpdatedAt, excerpt: h.excerpt, similarity: h.similarity, matchedTerms: h.matchedTerms, termCount: h.termCount, exactRef: h.exactRef };
}

export async function* runSearch(session: Session, input: { query: string; mode: SearchMode; filters: SearchFilters }): AsyncGenerator<SearchEvent> {
  const started = Date.now();
  const search = await db.search.create({ data: { userId: session.user.id, query: input.query, mode: input.mode, filters: input.filters as Prisma.InputJsonValue } });
  await db.auditEvent.create({ data: { actorId: session.user.id, action: `search.${input.mode}`, target: search.id, detail: { spaces: session.spaces.length } } });
  const filtered = Object.values(input.filters).some((v) => (Array.isArray(v) ? v.length : !!v));

  yield { type: "stage", stage: "understanding" };
  const q = parseQuery(input.query, await db.applicationAlias.findMany());

  yield { type: "stage", stage: "searching", detail: `${session.spaces.length} space${session.spaces.length === 1 ? "" : "s"} you can access` };
  const filters = input.mode === "similar" ? { ...input.filters, recordTypes: ["incident", "request", "problem", "bug", "chat", "email"] } : input.filters;
  const hits = await retrieve(q, session.principals, filters, 30);

  yield { type: "stage", stage: "ranking" };
  const recs = await loadRecords(hits.map((h) => h.recordId));
  const cardFor = (h: Hit, i: number) => { const r = recs.get(h.recordId); return r ? [card(h, r, i + 1, q.terms)] : []; };

  if (input.mode === "records") {
    // Keyword search: a record must share a term, be named exactly, or be a close semantic match.
    const records = hits.filter((h) => h.exactRef || h.matchedTerms >= 1 || h.similarity >= 0.83).flatMap((h) => cardFor(h, hits.indexOf(h)));
    yield { type: "records", records, sources: await coverage(session.principals, records) };
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  if (input.mode === "similar") {
    const records = hits.slice(0, 12).filter(isSupported).flatMap((h) => cardFor(h, hits.indexOf(h)).map((rec) => {
      const why: string[] = [];
      if (q.applications.length && rec.application && q.applications.includes(rec.application)) why.push(`Same application (${rec.application})`);
      if (h.matchedTerms >= 2) why.push(`${h.matchedTerms} matching terms`);
      if (h.similarity >= 0.86) why.push("Very similar description");
      else if (h.similarity >= 0.83) why.push("Similar description");
      if (rec.rootCause) why.push("Has a recorded root cause");
      return { ...rec, why };
    }));
    yield { type: "similar", records };
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  // ask / investigate
  const groupOf = (id: string) => { const r = recs.get(id); return r ? sourceGroup({ sourceSystem: r.sourceSystem, demo: isDemo(r.raw) }) : "other"; };
  const chosen = selectEvidence(hits, groupOf);
  const evidence: Evidence[] = chosen.flatMap((h, i) => { const r = recs.get(h.recordId); return r ? [toEvidence(h, r, i)] : []; });

  const insufficient = async (reason: "no-evidence" | "filters" | "model", clarification: string | null = null): Promise<SearchEvent> => {
    await db.answer.create({ data: { searchId: search.id, outcome: "insufficient", body: { reason, clarification }, provider: activeProvider().provider, promptVersion: ANSWER_PROMPT_VERSION, latencyMs: Date.now() - started } });
    const near = hits.filter((h) => h.similarity >= 0.8).slice(0, 3);
    return { type: "insufficient", reason, records: near.flatMap((h) => cardFor(h, hits.indexOf(h))), sources: await coverage(session.principals, []), clarification };
  };

  if (!hasEnoughEvidence(evidence)) {
    yield await insufficient(filtered ? "filters" : "no-evidence");
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  const supported = evidence.filter(isSupported);
  const shown = supported.flatMap((e) => { const h = chosen.find((x) => x.recordId === e.recordId)!; return cardFor(h, hits.indexOf(h)).map((c) => ({ ...c, evidenceId: e.id })); });
  const totalMatches = hits.filter(isSupported).length;
  const [sources, related] = await Promise.all([coverage(session.principals, shown), relatedIssues(hits, new Set(shown.map((c) => c.id)), recs, session.principals)]);
  yield { type: "evidence", records: shown, totalRelated: shown.length, totalMatches, sources, related };

  yield { type: "stage", stage: "writing" };
  const { provider, note } = activeProvider();
  let gen;
  try {
    gen = await generate(input.query, supported, input.mode === "investigate", provider);
  } catch (e) {
    console.error("[search] generation failed:", e instanceof Error ? e.message : e);
    yield { type: "error", message: "Synora found evidence but could not write an answer right now. The supporting records are shown; try again in a minute." };
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }
  const checked = enforceCitations(gen.body, supported);
  if (gen.insufficient || !checked.summary.length) {
    yield await insufficient("model", checked.clarification);
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  const citedIds = new Set([...checked.summary, ...checked.explanation, ...checked.steps, ...checked.hypotheses].flatMap((x) => x.citations));
  const cited = supported.filter((e) => citedIds.has(e.id));
  const warnings = warningsFor(cited);
  if (warnings.some((w) => w.kind === "historical" || w.kind === "temporary-fix")) {
    checked.steps.push({ title: "Validate findings before applying a previous resolution.", detail: "Historical fixes have not been approved as reusable knowledge.", basis: "recommended", citations: [] });
  }
  const body: AnswerBody = { ...checked, warnings };
  const confidence = computeConfidence(cited);
  const newest = cited.map((e) => e.updatedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const confirmed = cited.some(confirmedRootCause);
  const temporary = cited.some((e) => e.evidenceKind === "historical" && TEMPORARY.test(e.resolution ?? "") && !confirmedRootCause(e));
  const trust: Trust = {
    supporting: cited.length, related: shown.length, approved: cited.filter((e) => e.evidenceKind === "approved").length,
    lastEvidence: newest?.toISOString() ?? null, permissionAware: true,
    conflicting: temporary, stale: !!newest && Date.now() - newest.getTime() > 548 * 864e5,
    sourcesUsed: new Set(shown.filter((c) => citedIds.has(c.evidenceId!)).map((c) => c.group)).size,
    rootCause: confirmed ? "confirmed" : "unconfirmed",
    recovery: confirmed ? "verified" : temporary ? "temporary" : "unknown",
  };

  const answer = await db.answer.create({ data: {
    searchId: search.id, outcome: "answered", body: body as unknown as Prisma.InputJsonValue, confidence: confidence.level, confidenceWhy: confidence.why,
    provider, modelId: gen.modelId, promptVersion: ANSWER_PROMPT_VERSION, inputTokens: gen.inputTokens, outputTokens: gen.outputTokens, latencyMs: Date.now() - started,
    citations: { create: cited.map((e, i) => ({ recordId: e.recordId, ordinal: i })) },
  } });

  yield { type: "answer", body, confidence, provider, note, trust };
  yield { type: "done", searchId: search.id, answerId: answer.id, latencyMs: Date.now() - started };
}
