import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireSession();
  const [items, collections] = await Promise.all([
    db.savedItem.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } }),
    db.collection.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  // Pinned records are re-checked: access may have been removed since they were saved.
  const recs = await db.sourceRecord.findMany({ where: { id: { in: items.flatMap((i) => (i.recordId ? [i.recordId] : [])) }, deletedAt: null, acl: { hasSome: session.principals } }, select: { id: true, ref: true, sourceSystem: true } });
  return NextResponse.json({
    collections,
    items: items.map((i) => ({ ...i, record: i.recordId ? recs.find((r) => r.id === i.recordId) ?? null : null, unavailable: !!i.recordId && !recs.some((r) => r.id === i.recordId) })),
  });
});

const create = z.object({
  kind: z.enum(["search", "answer", "record"]),
  name: z.string().trim().min(1).max(160),
  query: z.string().max(4000).optional(),
  mode: z.string().max(20).optional(),
  answerId: z.string().optional(),
  recordId: z.string().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  collectionName: z.string().trim().max(120).optional(),
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  assertPermission(session, "save");
  const p = create.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new RequestError("That item can't be saved.");
  const { collectionName, ...data } = p.data;
  let collectionId: string | undefined;
  if (collectionName) collectionId = (await db.collection.create({ data: { userId: session.user.id, name: collectionName } })).id;
  const item = await db.savedItem.create({ data: { ...data, userId: session.user.id, collectionId } });
  return NextResponse.json(item, { status: 201 });
});

const update = z.object({ id: z.string(), name: z.string().trim().min(1).max(160).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(), collectionId: z.string().nullable().optional(), newCollection: z.string().trim().max(120).optional() });

export const PATCH = handle(async (req: Request) => {
  const session = await requireSession();
  const p = update.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new RequestError("Invalid change.");
  const { id, newCollection, ...data } = p.data;
  if (newCollection) data.collectionId = (await db.collection.create({ data: { userId: session.user.id, name: newCollection } })).id;
  if (data.collectionId && !(await db.collection.findFirst({ where: { id: data.collectionId, userId: session.user.id } }))) throw new RequestError("Unknown collection.");
  const r = await db.savedItem.updateMany({ where: { id, userId: session.user.id }, data });
  if (!r.count) throw new RequestError("Not found.", 404);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  const session = await requireSession();
  const ids = z.array(z.string()).min(1).max(200).safeParse((await req.json().catch(() => null))?.ids);
  if (!ids.success) throw new RequestError("Nothing to remove.");
  const r = await db.savedItem.deleteMany({ where: { id: { in: ids.data }, userId: session.user.id } });
  return NextResponse.json({ removed: r.count });
});
