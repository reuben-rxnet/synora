import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { connectorFor } from "@/lib/connectors/registry";
import { nextRun, secretReader } from "@/lib/connectors/sync";
import { enqueue } from "@/lib/jobs";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["sync", "full-sync", "pause", "resume", "test"]) });

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
