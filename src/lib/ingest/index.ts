// Stores connector items: change detection by content hash, chunking, embeddings, permissions and links.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { principal } from "@/lib/access";
import { embedder, toVector } from "@/lib/ai/embeddings";
import type { SourceItem } from "@/lib/connectors/types";

const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;

/** Splits on paragraph boundaries where possible. The first chunk carries the title so short records still match. */
export function chunkText(title: string, body: string): string[] {
  const text = `${title}\n${body}`.trim();
  if (text.length <= CHUNK_CHARS) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const para = text.lastIndexOf("\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const cut = Math.max(para, sentence);
      if (cut > start + CHUNK_CHARS / 2) end = cut + 1;
    }
    out.push((out.length ? `${title}\n` : "") + text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return out;
}

const ERROR_CODE = /\b(?:ERR_[A-Z_]+|HTTP \d{3}|AADSTS\d+|[A-Z]{2,}_\d{3}|0x[0-9A-F]{8})\b/g;
export const extractErrorCodes = (text: string) => [...new Set(text.match(ERROR_CODE) ?? [])].slice(0, 20);

export function contentHash(item: SourceItem): string {
  return createHash("sha256").update(JSON.stringify({ ...item, raw: undefined })).digest("hex");
}

/** The final permission list: the space (unless restricted) plus what the source allows. */
export function effectiveAcl(item: SourceItem, spaceId: string): string[] {
  const acl = new Set(item.acl);
  if (item.sensitivity !== "restricted") acl.add(principal.space(spaceId));
  return [...acl];
}

export interface UpsertResult { added: number; updated: number; unchanged: number }

export async function upsertItems(connectorId: string, spaceId: string, items: SourceItem[]): Promise<UpsertResult> {
  const result: UpsertResult = { added: 0, updated: 0, unchanged: 0 };
  const changed: { id: string; item: SourceItem }[] = [];
  const spaceIds = new Map((await db.space.findMany({ select: { id: true, key: true } })).map((s) => [s.key, s.id]));

  for (const item of items) {
    const hash = contentHash(item);
    // An unknown space key falls back to the connector's space, never to "everyone".
    const itemSpace = (item.spaceKey && spaceIds.get(item.spaceKey)) || spaceId;
    const existing = await db.sourceRecord.findUnique({ where: { connectorId_externalId: { connectorId, externalId: item.externalId } }, select: { id: true, contentHash: true, deletedAt: true } });
    if (existing && existing.contentHash === hash && !existing.deletedAt) { result.unchanged++; continue; }
    const data = {
      spaceId: itemSpace, ref: item.ref, sourceSystem: item.sourceSystem ?? "", recordType: item.recordType, title: item.title.slice(0, 500), body: item.body,
      evidenceKind: item.evidenceKind, approval: item.approval ?? (item.evidenceKind === "approved" ? "approved" : item.evidenceKind === "historical" ? "historical" : "not_reviewed"),
      application: item.application ?? null, module: item.module ?? null, environment: item.environment ?? null, location: item.location ?? null,
      category: item.category ?? null, ownerGroup: item.ownerGroup ?? null, priority: item.priority ?? null, status: item.status ?? null,
      rootCause: item.rootCause ?? null, resolution: item.resolution ?? null, errorCodes: extractErrorCodes(`${item.title}\n${item.body}`),
      sourceUrl: item.sourceUrl ?? null, sourceCreatedAt: item.createdAt ?? null, sourceUpdatedAt: item.updatedAt ?? null,
      sensitivity: item.sensitivity ?? "internal", acl: effectiveAcl(item, itemSpace), contentHash: hash,
      raw: item.raw === undefined ? Prisma.JsonNull : (item.raw as Prisma.InputJsonValue), deletedAt: null, indexedAt: new Date(),
    };
    const rec = existing
      ? await db.sourceRecord.update({ where: { id: existing.id }, data })
      : await db.sourceRecord.create({ data: { ...data, connectorId, externalId: item.externalId } });
    if (existing) result.updated++; else result.added++;
    changed.push({ id: rec.id, item });
  }

  await indexChunks(changed);
  await linkRecords(changed);
  return result;
}

async function indexChunks(changed: { id: string; item: SourceItem }[]) {
  if (!changed.length) return;
  const all = changed.flatMap(({ id, item }) => chunkText(item.title, `${item.body}${item.rootCause ? `\nRoot cause: ${item.rootCause}` : ""}${item.resolution ? `\nResolution: ${item.resolution}` : ""}`).map((text, ordinal) => ({ recordId: id, ordinal, text })));
  const vectors = await embedder().embed(all.map((c) => c.text), "passage");
  await db.chunk.deleteMany({ where: { recordId: { in: changed.map((c) => c.id) } } });
  for (let i = 0; i < all.length; i++) {
    const c = all[i]!;
    await db.$executeRaw`INSERT INTO "Chunk" (id, "recordId", ordinal, text, embedding) VALUES (${`ch_${c.recordId}_${c.ordinal}`}, ${c.recordId}, ${c.ordinal}, ${c.text}, ${toVector(vectors[i]!)}::vector)`;
  }
}

async function linkRecords(changed: { id: string; item: SourceItem }[]) {
  for (const { id, item } of changed) {
    for (const l of item.links ?? []) {
      // "WI-<id>" (an Azure DevOps work item named by number, from links and #mentions) resolves by its id, whatever its type code.
      const wi = /^WI-(\d+)$/.exec(l.ref)?.[1];
      const target = await db.sourceRecord.findFirst({ where: wi ? { sourceSystem: "Azure DevOps", externalId: wi, deletedAt: null } : { ref: l.ref, deletedAt: null }, select: { id: true } });
      if (target && target.id !== id) {
        await db.recordLink.upsert({ where: { fromId_toId_kind: { fromId: id, toId: target.id, kind: l.kind } }, update: {}, create: { fromId: id, toId: target.id, kind: l.kind } });
      }
    }
  }
}

/** Soft-deletes records the source removed; their chunks go so they can't be retrieved. */
export async function markDeleted(connectorId: string, externalIds: string[]): Promise<number> {
  if (!externalIds.length) return 0;
  const recs = await db.sourceRecord.findMany({ where: { connectorId, externalId: { in: externalIds }, deletedAt: null }, select: { id: true } });
  await db.chunk.deleteMany({ where: { recordId: { in: recs.map((r) => r.id) } } });
  await db.sourceRecord.updateMany({ where: { id: { in: recs.map((r) => r.id) } }, data: { deletedAt: new Date() } });
  return recs.length;
}
