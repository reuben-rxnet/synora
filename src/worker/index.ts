// Synora sync worker: runs queued jobs and schedules connector syncs. Start with `npm run worker`.
import { db } from "@/lib/db";
import { claimJob, enqueue, finishJob } from "@/lib/jobs";
import { runSync } from "@/lib/connectors/sync";
import { ConnectorError } from "@/lib/connectors/types";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 3000);
let stopping = false;

async function scheduleDueSyncs() {
  const due = await db.connector.findMany({ where: { status: { in: ["connected", "failed"] }, schedule: { not: "manual" }, nextSyncAt: { lte: new Date() } } });
  for (const c of due) await enqueue("sync", { connectorId: c.id }, { dedupeKey: `sync:${c.id}` });
}

async function tick() {
  await scheduleDueSyncs();
  for (let job = await claimJob(); job && !stopping; job = await claimJob()) {
    const started = Date.now();
    try {
      if (job.kind === "sync") {
        const { connectorId, full } = job.payload as { connectorId: string; full?: boolean };
        const r = await runSync(connectorId, { full });
        console.log(`[worker] sync ${connectorId} done in ${Date.now() - started} ms`, r);
      }
      await finishJob(job.id);
    } catch (e) {
      // Sign-in problems are not retried: repeated attempts could lock the account.
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof ConnectorError && !e.retryable) await db.job.update({ where: { id: job.id }, data: { maxAttempts: job.attempts } });
      await finishJob(job.id, message);
      console.error(`[worker] job ${job.kind} failed: ${message}`);
    }
  }
}

async function main() {
  console.log(`[worker] Synora sync worker started (poll every ${POLL_MS} ms).`);
  while (!stopping) {
    try { await tick(); } catch (e) { console.error("[worker] tick failed", e instanceof Error ? e.message : e); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
void main();
