// The search flow behind /api/search. Yields events the UI renders as they arrive:
//   stage → evidence → answer | insufficient | records | similar → done
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth/session";
import { parseQuery } from "./query";
import { retrieve, type SearchFilters } from "./retrieve";
import { ANSWER_PROMPT_VERSION, activeProvider, computeConfidence, enforceCitations, generate, hasEnoughEvidence, isSupported, warningsFor, type AnswerBody, type Confidence, type Evidence } from "./answer";

export type SearchMode = "ask" | "records" | "similar" | "investigate";

export interface RecordCard {
  id: string; ref: string; title: string; sourceSystem: string; recordType: string; evidenceKind: string;
  status: string | null; application: string | null; location: string | null; ownerGroup: string | null;
  updatedAt: string | null; similarity: number; rootCause: string | null; resolution: string | null; excerpt: string;
  space: string; sensitivity: string; links: string[]; evidenceId?: string;
}

export type SearchEvent =
  | { type: "stage"; stage: "understanding" | "searching" | "ranking" | "writing"; detail?: string }
  | { type: "evidence"; records: RecordCard[]; totalRelated: number }
  | { type: "answer"; body: AnswerBody; confidence: Confidence; provider: string; note: string | null; trust: Trust }
  | { type: "insufficient"; reason: "no-evidence" | "filters" | "model"; records: RecordCard[] }
  | { type: "records"; records: RecordCard[] }
  | { type: "similar"; records: (RecordCard & { why: string[] })[] }
  | { type: "done"; searchId: string; answerId: string | null; latencyMs: number }
  | { type: "error"; message: string };

export interface Trust { supporting: number; related: number; approved: number; lastEvidence: string | null; permissionAware: true; conflicting: boolean; stale: boolean }

async function cards(hits: Awaited<ReturnType<typeof retrieve>>): Promise<RecordCard[]> {
  const recs = await db.sourceRecord.findMany({
    where: { id: { in: hits.map((h) => h.recordId) } },
    include: { space: { select: { name: true } }, linksFrom: { include: { to: { select: { ref: true } } } }, linksTo: { include: { from: { select: { ref: true } } } } },
  });
  return hits.flatMap((h) => {
    const r = recs.find((x) => x.id === h.recordId);
    if (!r) return [];
    return [{
      id: r.id, ref: r.ref, title: r.title, sourceSystem: r.sourceSystem, recordType: r.recordType, evidenceKind: r.evidenceKind,
      status: r.status, application: r.application, location: r.location, ownerGroup: r.ownerGroup,
      updatedAt: (r.sourceUpdatedAt ?? r.indexedAt).toISOString(), similarity: Math.round(Math.max(0, Math.min(1, h.similarity)) * 100),
      rootCause: r.rootCause, resolution: r.resolution, excerpt: h.excerpt.replace(r.title, "").trim().slice(0, 400),
      space: r.space.name, sensitivity: r.sensitivity, links: [...r.linksFrom.map((l) => l.to.ref), ...r.linksTo.map((l) => l.from.ref)],
    }];
  });
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
  const hits = await retrieve(q, session.principals, filters, input.mode === "records" ? 30 : 12);

  yield { type: "stage", stage: "ranking" };
  const all = await cards(hits);

  if (input.mode === "records") {
    // Keyword search: a record must share a term, be named exactly, or be a close semantic match.
    const relevant = new Set(hits.filter((h) => h.exactRef || h.matchedTerms >= 1 || h.similarity >= 0.83).map((h) => h.recordId));
    yield { type: "records", records: all.filter((c) => relevant.has(c.id)) };
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  if (input.mode === "similar") {
    const hitById = new Map(hits.map((h) => [h.recordId, h]));
    const records = all.filter((c) => isSupported(hitById.get(c.id)!)).map((rec) => {
      const h = hitById.get(rec.id)!;
      const why: string[] = [];
      if (q.applications.length && rec.application && q.applications.includes(rec.application)) why.push(`Same application (${rec.application})`);
      if (h.matchedTerms >= 2) why.push(`${h.matchedTerms} matching terms`);
      if (h.similarity >= 0.86) why.push("Very similar description");
      else if (h.similarity >= 0.83) why.push("Similar description");
      if (rec.rootCause) why.push("Has a recorded root cause");
      return { ...rec, why };
    });
    yield { type: "similar", records };
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  // ask / investigate
  const recs = await db.sourceRecord.findMany({ where: { id: { in: hits.map((h) => h.recordId) } } });
  const evidence: Evidence[] = hits.slice(0, 8).flatMap((h, i) => {
    const r = recs.find((x) => x.id === h.recordId);
    return r ? [{ id: `E${i + 1}`, recordId: r.id, ref: r.ref, sourceSystem: r.sourceSystem, recordType: r.recordType, evidenceKind: r.evidenceKind, title: r.title, status: r.status, application: r.application, rootCause: r.rootCause, resolution: r.resolution, updatedAt: r.sourceUpdatedAt, excerpt: h.excerpt, similarity: h.similarity, matchedTerms: h.matchedTerms, exactRef: h.exactRef }] : [];
  });

  const insufficient = async (reason: "no-evidence" | "filters" | "model"): Promise<SearchEvent> => {
    await db.answer.create({ data: { searchId: search.id, outcome: "insufficient", body: { reason }, provider: activeProvider().provider, promptVersion: ANSWER_PROMPT_VERSION, latencyMs: Date.now() - started } });
    const near = new Set(hits.filter((h) => h.similarity >= 0.8).map((h) => h.recordId));
    return { type: "insufficient", reason, records: all.filter((c) => near.has(c.id)).slice(0, 3) };
  };

  if (!hasEnoughEvidence(evidence)) {
    yield await insufficient(filtered ? "filters" : "no-evidence");
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  const supported = evidence.filter(isSupported);
  const shown = all.filter((c) => supported.some((e) => e.recordId === c.id)).map((c) => ({ ...c, evidenceId: supported.find((e) => e.recordId === c.id)!.id }));
  yield { type: "evidence", records: shown, totalRelated: shown.length };

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
    yield await insufficient("model");
    yield { type: "done", searchId: search.id, answerId: null, latencyMs: Date.now() - started };
    return;
  }

  const citedIds = new Set([...checked.summary, ...checked.steps, ...checked.hypotheses].flatMap((x) => x.citations));
  const cited = supported.filter((e) => citedIds.has(e.id));
  const warnings = warningsFor(cited);
  if (warnings.some((w) => w.kind === "historical" || w.kind === "temporary-fix")) {
    checked.steps.push({ title: "Validate findings before applying a previous resolution.", detail: "Historical fixes have not been approved as reusable knowledge.", citations: [] });
  }
  const body: AnswerBody = { ...checked, warnings };
  const confidence = computeConfidence(cited);
  const newest = cited.map((e) => e.updatedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const trust: Trust = {
    supporting: cited.length, related: shown.length, approved: cited.filter((e) => e.evidenceKind === "approved").length,
    lastEvidence: newest?.toISOString() ?? null, permissionAware: true,
    conflicting: warnings.some((w) => w.kind === "temporary-fix"), stale: !!newest && Date.now() - newest.getTime() > 548 * 864e5,
  };

  const answer = await db.answer.create({ data: {
    searchId: search.id, outcome: "answered", body: body as unknown as Prisma.InputJsonValue, confidence: confidence.level, confidenceWhy: confidence.why,
    provider, modelId: gen.modelId, promptVersion: ANSWER_PROMPT_VERSION, inputTokens: gen.inputTokens, outputTokens: gen.outputTokens, latencyMs: Date.now() - started,
    citations: { create: cited.map((e, i) => ({ recordId: e.recordId, ordinal: i })) },
  } });

  yield { type: "answer", body, confidence, provider, note, trust };
  yield { type: "done", searchId: search.id, answerId: answer.id, latencyMs: Date.now() - started };
}
