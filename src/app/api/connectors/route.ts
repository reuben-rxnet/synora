import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireSession();
  assertPermission(session, "connectors.view");
  const connectors = await db.connector.findMany({ include: { space: { select: { name: true } }, runs: { orderBy: { startedAt: "desc" }, take: 8 } }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    catalog: CONNECTOR_CATALOG,
    canManage: session.permissions.has("connectors.manage"),
    connectors: connectors.map((c) => ({
      id: c.id, type: c.type, name: c.name, space: c.space.name, status: c.status, statusNote: c.statusNote, schedule: c.schedule,
      ownerGroup: c.ownerGroup, lastSyncAt: c.lastSyncAt, nextSyncAt: c.nextSyncAt, recordCount: c.recordCount,
      config: c.config, secretRef: c.secretRef ? c.secretRef.replace(/^(env:|kv:\/\/)(.*)$/, (_, p: string, n: string) => `${p}${n}`) : null,
      runs: c.runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, added: r.added, updated: r.updated, unchanged: r.unchanged, deleted: r.deleted, failed: r.failed, errorText: r.errorText })),
    })),
  });
});
