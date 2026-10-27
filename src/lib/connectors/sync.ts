// Runs one sync for a connector: records the run, stores batches, saves the cursor after each batch
// (so an interrupted sync resumes there), syncs group memberships and updates the connector's status.
import { db } from "@/lib/db";
import { markDeleted, upsertItems } from "@/lib/ingest";
import { connectorFor } from "./registry";
import { ConnectorError, type SyncContext } from "./types";

/** Secrets come from the environment locally and from Key Vault in production; the reference names which one. */
export function secretReader(secretRef: string | null) {
  return (name: string) => {
    if (secretRef?.startsWith("env:")) return process.env[secretRef.slice(4)] ?? process.env[name];
    return process.env[name];
  };
}

export async function runSync(connectorId: string, opts: { full?: boolean } = {}) {
  const c = await db.connector.findUniqueOrThrow({ where: { id: connectorId } });
  if (c.status === "paused") return { skipped: "paused" as const };
  const run = await db.syncRun.create({ data: { connectorId, kind: opts.full || !c.cursor ? "full" : "incremental" } });
  await db.connector.update({ where: { id: connectorId }, data: { status: "syncing", statusNote: null } });

  const ctx: SyncContext = {
    connectorId, spaceId: c.spaceId, config: (c.config ?? {}) as Record<string, unknown>,
    secret: secretReader(c.secretRef),
    log: (message) => void db.syncError.create({ data: { runId: run.id, code: "NOTE", message } }).catch(() => undefined),
  };
  const totals = { added: 0, updated: 0, unchanged: 0, deleted: 0 };
  try {
    const connector = connectorFor(c.type);
    for await (const batch of connector.fetchChanges(ctx, opts.full ? null : c.cursor)) {
      const r = await upsertItems(connectorId, c.spaceId, batch.items.map((i) => ({ ...i, sourceSystem: i.sourceSystem || connector.label })));
      totals.added += r.added; totals.updated += r.updated; totals.unchanged += r.unchanged;
      totals.deleted += await markDeleted(connectorId, batch.deleted ?? []);
      await db.connector.update({ where: { id: connectorId }, data: { cursor: batch.cursor } });
      await db.syncRun.update({ where: { id: run.id }, data: totals });
    }
    if (connector.fetchMemberships && (opts.full || !c.cursor || await membershipsDue(c.type, connector.membershipSyncHours))) {
      await syncMemberships(await connector.fetchMemberships(ctx));
    }

    const recordCount = await db.sourceRecord.count({ where: { connectorId, deletedAt: null } });
    await db.syncRun.update({ where: { id: run.id }, data: { ...totals, status: "succeeded", finishedAt: new Date() } });
    await db.connector.update({ where: { id: connectorId }, data: { status: "connected", lastSyncAt: new Date(), nextSyncAt: nextRun(c.schedule), recordCount } });
    await db.auditEvent.create({ data: { action: "connector.sync", target: c.name, detail: { connectorId, ...totals } } });
    return { runId: run.id, ...totals };
  } catch (e) {
    const code = e instanceof ConnectorError ? e.code : "SYNC_FAILED";
    const text = e instanceof ConnectorError ? e.message : "The sync stopped because of an unexpected error. See the worker window for details.";
    if (!(e instanceof ConnectorError)) console.error("[sync]", e);
    await db.syncRun.update({ where: { id: run.id }, data: { ...totals, status: totals.added + totals.updated ? "partial" : "failed", finishedAt: new Date(), errorCode: code, errorText: text } });
    // The next attempt waits for the normal schedule: a failing source is not called again every few seconds.
    await db.connector.update({ where: { id: connectorId }, data: { status: code === "AUTH" || code === "SETUP" ? "action_required" : "failed", statusNote: text, nextSyncAt: nextRun(c.schedule) } });
    throw e;
  }
}

/** Group keys are prefixed with the connector type ("hda:G815L"), so the newest one says when they were last read. */
async function membershipsDue(type: string, hours?: number) {
  if (!hours) return true;
  const last = await db.group.findFirst({ where: { key: { startsWith: `${type}:` } }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } });
  return !last || Date.now() - last.syncedAt.getTime() > hours * 3600_000;
}

/** Replaces each source group's members with the logins the source reports, matched to users by email or HDA username. */
export async function syncMemberships(groups: { groupKey: string; groupName: string; memberLogins: string[] }[]) {
  for (const g of groups) {
    const group = await db.group.upsert({ where: { key: g.groupKey }, update: { name: g.groupName, syncedAt: new Date() }, create: { key: g.groupKey, name: g.groupName, source: g.groupKey.split(":")[0] ?? "source" } });
    const logins = g.memberLogins.map((l) => l.toLowerCase());
    const users = await db.user.findMany({ where: { OR: [{ email: { in: logins } }, { hdaUsername: { in: logins } }] }, select: { id: true } });
    await db.$transaction([
      db.userGroup.deleteMany({ where: { groupId: group.id, userId: { notIn: users.map((u) => u.id) } } }),
      ...users.map((u) => db.userGroup.upsert({ where: { userId_groupId: { userId: u.id, groupId: group.id } }, update: {}, create: { userId: u.id, groupId: group.id } })),
    ]);
  }
}

export function nextRun(schedule: string, from = new Date()): Date | null {
  const minutes = { "15min": 15, hourly: 60, "6h": 360, daily: 1440 }[schedule];
  return minutes ? new Date(from.getTime() + minutes * 60_000) : null;
}
