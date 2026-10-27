import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { CONNECTOR_CATALOG, CONNECTORS } from "@/lib/connectors/registry";
import { adoConnectorRow } from "@/lib/connectors/ado/connector";
import { m365ConnectorRow } from "@/lib/connectors/m365/connector";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireSession();
  assertPermission(session, "connectors.view");
  const [connectors, live] = await Promise.all([
    db.connector.findMany({ include: { space: { select: { name: true } }, runs: { orderBy: { startedAt: "desc" }, take: 8 } }, orderBy: { createdAt: "asc" } }),
    // The stored count is only refreshed when a sync finishes; while one runs, count the records directly.
    db.sourceRecord.groupBy({ by: ["connectorId"], where: { deletedAt: null }, _count: true }),
  ]);
  const progressOf = (c: (typeof connectors)[number]) => {
    const run = c.runs.find((r) => r.status === "running");
    let p = null;
    try { p = CONNECTORS[c.type]?.progress?.(c.cursor) ?? null; } catch { /* unreadable cursor: no progress shown */ }
    if (!run && !p) return null;
    const minutes = run ? (Date.now() - run.startedAt.getTime()) / 60_000 : 0;
    const done = run ? run.added + run.updated + run.unchanged : 0;
    return { ...(p ?? { position: null, fraction: null }), running: !!run, itemsThisRun: done, perMinute: run && minutes > 1 ? Math.round(done / minutes) : null, runStartedAt: run?.startedAt ?? null };
  };
  return NextResponse.json({
    catalog: CONNECTOR_CATALOG,
    canManage: session.permissions.has("connectors.manage"),
    connectors: connectors.map((c) => ({
      id: c.id, type: c.type, name: c.name, space: c.space.name, status: c.status, statusNote: c.statusNote, schedule: c.schedule,
      ownerGroup: c.ownerGroup, lastSyncAt: c.lastSyncAt, nextSyncAt: c.nextSyncAt, recordCount: live.find((l) => l.connectorId === c.id)?._count ?? c.recordCount,
      progress: progressOf(c),
      config: c.config, secretRef: c.secretRef ? c.secretRef.replace(/^(env:|kv:\/\/)(.*)$/, (_, p: string, n: string) => `${p}${n}`) : null,
      runs: c.runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, added: r.added, updated: r.updated, unchanged: r.unchanged, deleted: r.deleted, failed: r.failed, errorText: r.errorText })),
    })),
  });
});

/** Adds a connector of a type that can be set up from the Sources page (Azure DevOps, SharePoint & OneDrive). One per type for now. */
export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  assertPermission(session, "connectors.manage");
  const { type } = ((await req.json().catch(() => ({}))) ?? {}) as { type?: string };
  if (type !== "ado" && type !== "m365") throw new RequestError("This source type can't be added from here yet.");
  if (await db.connector.findFirst({ where: { type } })) throw new RequestError(`${type === "ado" ? "Azure DevOps" : "SharePoint & OneDrive"} is already in the list of sources.`);
  const space = await db.space.findUnique({ where: { key: type === "ado" ? "development" : "it-support" } });
  if (!space) throw new RequestError("The space for this source is missing. Run npm run db:seed.", 409);
  const c = await db.connector.create({ data: type === "ado" ? adoConnectorRow(space.id) : m365ConnectorRow(space.id) });
  await db.auditEvent.create({ data: { actorId: session.user.id, action: "connector.create", target: c.name, detail: { connectorId: c.id, type } } });
  return NextResponse.json({ ok: true, id: c.id });
});
