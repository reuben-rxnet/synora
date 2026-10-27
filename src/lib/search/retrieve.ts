// Hybrid retrieval: vector similarity and keyword match, fused with reciprocal rank fusion.
// Permission filtering is part of both SQL queries (acl && principals), so a record the person can't see is
// never scored, never ranked and never reaches the model.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { embedder, toVector } from "@/lib/ai/embeddings";
import { tsQuery, type ParsedQuery } from "./query";

export interface SearchFilters {
  spaces?: string[];
  sourceSystems?: string[];
  applications?: string[];
  recordTypes?: string[];
  statuses?: string[];
  evidenceKinds?: string[];
  updatedWithinDays?: number | null;
}

export interface Hit {
  recordId: string;
  score: number;
  similarity: number;
  keywordRank: number | null;
  matchedTerms: number;
  exactRef: boolean;
  excerpt: string;
}

const RRF_K = 60;
const CANDIDATES = 60;

function filterSql(f: SearchFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`r."deletedAt" IS NULL`];
  if (f.spaces?.length) parts.push(Prisma.sql`r."spaceId" = ANY(${f.spaces}::text[])`);
  if (f.sourceSystems?.length) parts.push(Prisma.sql`r."sourceSystem" = ANY(${f.sourceSystems}::text[])`);
  if (f.applications?.length) parts.push(Prisma.sql`r.application = ANY(${f.applications}::text[])`);
  if (f.recordTypes?.length) parts.push(Prisma.sql`r."recordType" = ANY(${f.recordTypes}::text[])`);
  if (f.statuses?.length) parts.push(Prisma.sql`r.status = ANY(${f.statuses}::text[])`);
  if (f.evidenceKinds?.length) parts.push(Prisma.sql`r."evidenceKind" = ANY(${f.evidenceKinds}::text[])`);
  if (f.updatedWithinDays) parts.push(Prisma.sql`coalesce(r."sourceUpdatedAt", r."indexedAt") >= now() - (${f.updatedWithinDays} * interval '1 day')`);
  return Prisma.join(parts, " AND ");
}

export async function retrieve(q: ParsedQuery, principals: string[], filters: SearchFilters = {}, limit = 12): Promise<Hit[]> {
  const where = filterSql(filters);
  const [vec] = await embedder().embed([q.text], "query");
  const tsq = tsQuery(q.terms);

  const vectorRows = await db.$queryRaw<{ recordId: string; chunkId: string; sim: number }[]>`
    SELECT c."recordId", c.id AS "chunkId", 1 - (c.embedding <=> ${toVector(vec!)}::vector) AS sim
    FROM "Chunk" c JOIN "SourceRecord" r ON r.id = c."recordId"
    WHERE ${where} AND r.acl && ${principals}::text[] AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${toVector(vec!)}::vector LIMIT ${CANDIDATES}`;

  const keywordRows = tsq ? await db.$queryRaw<{ recordId: string; chunkId: string; rank: number; matched: number }[]>`
    SELECT c."recordId", c.id AS "chunkId", ts_rank_cd(c.tsv, to_tsquery('simple', ${tsq})) AS rank,
      (SELECT count(*)::int FROM unnest(${q.terms}::text[]) t WHERE c.tsv @@ to_tsquery('simple', regexp_replace(t, '[^[:alnum:]]+', '', 'g') || ':*')) AS matched
    FROM "Chunk" c JOIN "SourceRecord" r ON r.id = c."recordId"
    WHERE ${where} AND r.acl && ${principals}::text[] AND c.tsv @@ to_tsquery('simple', ${tsq})
    ORDER BY rank DESC LIMIT ${CANDIDATES}` : [];

  const refRows = q.refs.length ? await db.$queryRaw<{ recordId: string; chunkId: string }[]>`
    SELECT r.id AS "recordId", (SELECT c.id FROM "Chunk" c WHERE c."recordId" = r.id ORDER BY c.ordinal LIMIT 1) AS "chunkId" FROM "SourceRecord" r WHERE ${where} AND r.acl && ${principals}::text[] AND upper(r.ref) = ANY(${q.refs}::text[])` : [];

  const byRecord = new Map<string, Hit & { chunkId: string }>();
  const get = (recordId: string, chunkId: string) => {
    let h = byRecord.get(recordId);
    if (!h) { h = { recordId, chunkId, score: 0, similarity: 0, keywordRank: null, matchedTerms: 0, exactRef: false, excerpt: "" }; byRecord.set(recordId, h); }
    return h;
  };
  const seenV = new Set<string>();
  vectorRows.forEach((row) => {
    const h = get(row.recordId, row.chunkId);
    if (row.sim > h.similarity) { h.similarity = row.sim; h.chunkId = row.chunkId; }
    if (!seenV.has(row.recordId)) { seenV.add(row.recordId); h.score += 1 / (RRF_K + seenV.size); }
  });
  const seenK = new Set<string>();
  keywordRows.forEach((row) => {
    const h = get(row.recordId, row.chunkId);
    h.matchedTerms = Math.max(h.matchedTerms, row.matched);
    if (!seenK.has(row.recordId)) { seenK.add(row.recordId); h.keywordRank = seenK.size; h.score += 1 / (RRF_K + seenK.size); }
  });
  for (const row of refRows) { const h = get(row.recordId, row.chunkId); h.exactRef = true; h.score += 1; }

  const top = [...byRecord.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const chunks = await db.chunk.findMany({ where: { id: { in: top.map((t) => t.chunkId) } }, select: { id: true, text: true } });
  const text = new Map(chunks.map((c) => [c.id, c.text]));
  return top.map(({ chunkId, ...h }) => ({ ...h, excerpt: (text.get(chunkId) ?? "").slice(0, 900) }));
}
