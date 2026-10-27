import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { connectorFor } from "@/lib/connectors/registry";
import { activeGroups } from "@/lib/connectors/hda/connector";
import { nextRun, secretReader } from "@/lib/connectors/sync";
import { markDeleted } from "@/lib/ingest";
import { enqueue } from "@/lib/jobs";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

const group = z.object({ id: z.string().min(1).max(40), name: z.string().max(200) });
const body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["sync", "full-sync", "pause", "resume", "test"]) }),
  z.object({ action: z.literal("owner-groups"), groups: z.array(group).max(500) }),
]);

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/connectors/[id]">) => {
  const session = await requireSession();
  assertPermission(session, "connectors.manage");
  const { id } = await ctx.params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new RequestError("Unknown connector action.");
  const c = await db.connector.findUnique({ where: { id } });
  if (!c) throw new RequestError("That connector no longer exists.", 404);
  const action = parsed.data.action;
  const audit = (detail: object = {}) => db.auditEvent.create({ data: { actorId: session.user.id, action: `connector.${action}`, target: c.name, detail: { connectorId: c.id, ...detail } } });

  if (action === "test") {
    const result = await connectorFor(c.type).testConnection({ connectorId: c.id, spaceId: c.spaceId, config: c.config as Record<string, unknown>, secret: secretReader(c.secretRef), log: () => undefined });
    if (result.ok && c.status === "not_configured") await db.connector.update({ where: { id }, data: { status: "connected", statusNote: null, nextSyncAt: new Date() } });
    if (!result.ok) await db.connector.update({ where: { id }, data: { statusNote: result.message } });
    await audit({ level: result.level });
    return NextResponse.json(result);
  }
  if (parsed.data.action === "owner-groups") {
    if (c.type !== "hda") throw new RequestError("Owner groups only apply to HDA connectors.");
    const groups = [...new Map(parsed.data.groups.map((g) => [g.id, g])).values()];
    const before = activeGroups(c.config as Record<string, unknown>);
    const added = groups.filter((g) => !before.some((b) => b.id === g.id));
    const removed = before.filter((b) => !groups.some((g) => g.id === b.id));
    // Tickets of groups that are no longer active leave the index right away (records stored before owner-group
    // ids were kept are matched by group name).
    const stale = await db.$queryRaw<{ externalId: string }[]>`
      SELECT "externalId" FROM "SourceRecord" WHERE "connectorId" = ${c.id} AND "deletedAt" IS NULL
        AND NOT (coalesce(raw->>'ownerGroupId', '') = ANY(${groups.map((g) => g.id)}::text[]) OR coalesce("ownerGroup", '') = ANY(${groups.map((g) => g.name)}::text[]))`;
    const deleted = await markDeleted(c.id, stale.map((r) => r.externalId));
    const recordCount = await db.sourceRecord.count({ where: { connectorId: c.id, deletedAt: null } });
    // Newly activated groups need their history, so the next sync is a full one (unchanged tickets are skipped).
    const syncNow = groups.length > 0 && added.length > 0 && c.status !== "paused" && c.status !== "not_configured";
    await db.connector.update({ where: { id }, data: {
      config: { ...(c.config as Record<string, unknown>), ownerGroups: groups }, recordCount,
      ...(added.length ? { cursor: null } : {}),
      ...(syncNow ? { status: "syncing", statusNote: "Queued. Reading the tickets of the newly activated owner groups." } : {}),
      ...(!groups.length && c.status !== "paused" && c.status !== "not_configured" ? { status: "action_required", statusNote: "Activate at least one HDA owner group before syncing." } : {}),
      ...(groups.length && c.status === "action_required" && !syncNow ? { status: "connected", statusNote: null, nextSyncAt: nextRun(c.schedule) } : {}),
    } });
    if (syncNow) await enqueue("sync", { connectorId: c.id, full: true }, { dedupeKey: `sync:${c.id}` });
    await audit({ active: groups.map((g) => g.id), added: added.map((g) => g.id), removed: removed.map((g) => g.id), recordsRemoved: deleted });
    return NextResponse.json({ ok: true, active: groups, recordsRemoved: deleted, syncQueued: syncNow });
  }
  if (action === "pause" || action === "resume") {
    if (action === "resume" && c.status !== "paused") throw new RequestError("The connector isn't paused.");
    await db.connector.update({ where: { id }, data: action === "pause" ? { status: "paused", nextSyncAt: null } : { status: "connected", nextSyncAt: nextRun(c.schedule) } });
    await audit();
    return NextResponse.json({ ok: true });
  }
  if (c.status === "paused") throw new RequestError("Resume the connector before syncing.");
  if (c.status === "not_configured") throw new RequestError("Test the connection first.");
  const job = await enqueue("sync", { connectorId: c.id, full: action === "full-sync" }, { dedupeKey: `sync:${c.id}` });
  await db.connector.update({ where: { id }, data: { status: "syncing", statusNote: "Queued. The sync worker picks it up within a few seconds." } });
  await audit({ jobId: job.id });
  return NextResponse.json({ ok: true, jobId: job.id });
});
