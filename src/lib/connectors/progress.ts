// How far a sync has got, read from its saved cursor only (no calls to the source). Sources that are read
// oldest-first by a date (HDA, Azure DevOps work items) can't cheaply say how many items remain, so progress is the
// share of the time window already covered: approximate, and labelled as such.
export interface SyncProgress {
  /** e.g. "Work items changed up to 12 Mar 2025" */
  position: string;
  /** 0–1 share of the window covered, or null when it can't be told. */
  fraction: number | null;
  detail?: string;
}

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Position in a "last N days" window that is read oldest-first. */
export function datePosition(label: string, at: Date | null, lookbackDays: number, now = new Date()): SyncProgress | null {
  if (!at || Number.isNaN(at.getTime())) return null;
  const start = now.getTime() - lookbackDays * 864e5;
  const fraction = Math.max(0, Math.min(1, (at.getTime() - start) / (now.getTime() - start)));
  const daysLeft = Math.max(0, Math.round((now.getTime() - at.getTime()) / 864e5));
  return { position: `${label} up to ${fmt(at)}`, fraction, detail: daysLeft > 1 ? `${daysLeft} days of changes left to read` : "Up to date" };
}
