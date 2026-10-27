// A small Postgres job queue. Jobs are claimed with FOR UPDATE SKIP LOCKED and a lease, so several workers can
// run safely and a job whose worker died is picked up again when its lease runs out.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type JobKind = "sync";

export async function enqueue(kind: JobKind, payload: Record<string, unknown>, opts: { runAt?: Date; dedupeKey?: string } = {}) {
  if (opts.dedupeKey) {
    const pending = await db.job.findFirst({ where: { kind, status: { in: ["queued", "running"] }, payload: { path: ["key"], equals: opts.dedupeKey } } });
    if (pending) return pending;
  }
  return db.job.create({ data: { kind, payload: { ...payload, ...(opts.dedupeKey ? { key: opts.dedupeKey } : {}) } as Prisma.InputJsonValue, runAt: opts.runAt ?? new Date() } });
}

/** How long a claimed job stays locked without a heartbeat. The worker renews it every minute while it runs. */
export const LEASE_MS = 5 * 60_000;

export async function claimJob(leaseMs = LEASE_MS) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'running', "lockedUntil" = now() + (${leaseMs} * interval '1 millisecond'), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job"
      WHERE (status = 'queued' AND "runAt" <= now()) OR (status = 'running' AND "lockedUntil" < now() AND attempts < "maxAttempts")
      ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING id`;
  return rows[0] ? db.job.findUnique({ where: { id: rows[0].id } }) : null;
}

export async function finishJob(id: string, error?: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  if (!error) return db.job.update({ where: { id }, data: { status: "done", finishedAt: new Date(), lockedUntil: null } });
  const retry = job.attempts < job.maxAttempts;
  return db.job.update({ where: { id }, data: { status: retry ? "queued" : "failed", lastError: error.slice(0, 500), lockedUntil: null, runAt: new Date(Date.now() + 60_000 * 2 ** job.attempts), finishedAt: retry ? null : new Date() } });
}

/** Keeps a running job's lock fresh, so a sync that takes hours is never mistaken for one whose worker died. */
export async function renewLease(id: string, leaseMs = LEASE_MS) {
  await db.job.updateMany({ where: { id, status: "running" }, data: { lockedUntil: new Date(Date.now() + leaseMs) } });
}

/**
 * Jobs whose worker stopped (computer shut down, window closed) go back in the queue once their lock runs out.
 * An interruption isn't a failure, so it doesn't use up one of the job's attempts.
 */
export async function requeueInterrupted(): Promise<number> {
  const stale = await db.job.findMany({ where: { status: "running", lockedUntil: { lt: new Date() } }, select: { id: true, attempts: true } });
  for (const j of stale) {
    await db.job.update({ where: { id: j.id }, data: { status: "queued", attempts: Math.max(0, j.attempts - 1), lockedUntil: null, runAt: new Date() } });
  }
  return stale.length;
}
