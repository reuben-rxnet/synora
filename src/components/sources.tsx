"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { fmtDate, useShell } from "./shell";
import { Badge, Btn, Callout, Drawer, Empty, Icon, Modal, SourceIcon, StatusPill, Tabs, fmtNum } from "./ui";

interface Run { id: string; kind: string; status: string; startedAt: string; finishedAt: string | null; added: number; updated: number; unchanged: number; deleted: number; failed: number; errorText: string | null }
interface Progress { position: string | null; fraction: number | null; detail?: string; running: boolean; itemsThisRun: number; perMinute: number | null; runStartedAt: string | null }
interface Conn { progress: Progress | null; id: string; type: string; name: string; space: string; status: string; statusNote: string | null; schedule: string; ownerGroup: string; lastSyncAt: string | null; nextSyncAt: string | null; recordCount: number; config: Record<string, unknown>; secretRef: string | null; runs: Run[] }
interface OwnerGroup { id: string; name: string }
interface Folder { driveId: string; itemId: string; name: string; path: string; source: "sharepoint" | "onedrive"; approved?: boolean }
interface Catalog { type: string; name: string; category: string; description: string; available: boolean }

const SCHEDULE: Record<string, string> = { "15min": "Every 15 minutes", hourly: "Hourly", "6h": "Every 6 hours", daily: "Daily", manual: "Manual only" };
const folders = (c: Conn): Folder[] => (Array.isArray(c.config.folders) ? (c.config.folders as Folder[]) : []);
const m365Account = (c: Conn) => (c.config.account as { name?: string; upn?: string } | undefined) ?? null;
const M365_RESULT: Record<string, [string, "good" | "bad" | "info"]> = {
  connected: ["Signed in to Microsoft 365. Now choose the folders Synora should read.", "good"],
  expired: ["The Microsoft 365 sign-in took too long or was started elsewhere. Try again.", "bad"],
  "not-configured": ["The Microsoft 365 app registration isn't set up yet (M365_CLIENT_ID and secret in .env). See README → SharePoint & OneDrive.", "bad"],
  forbidden: ["Only administrators can connect sources.", "bad"],
  missing: ["That connector no longer exists.", "bad"],
};
const ownerGroups = (c: Conn): OwnerGroup[] => (Array.isArray(c.config.ownerGroups) ? (c.config.ownerGroups as OwnerGroup[]) : []);
/** Where a sync has got. The share is by date for sources read oldest-first, so it is labelled approximate. */
function SyncProgressView({ p }: { p: Progress }) {
  if (!p.running && !p.position) return null;
  const pct = p.fraction === null ? null : Math.round(p.fraction * 100);
  return (
    <div className="sync-prog" aria-label="Sync progress">
      {pct !== null && <div className="sync-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share of the sync window covered"><span style={{ width: `${pct}%` }} /></div>}
      <p className="small">
        {p.position && <b>{p.position}</b>}{pct !== null && <span className="muted"> · about {pct}% of the window{p.running ? "" : " at the last sync"}</span>}
        {p.detail && <><br /><span className="muted">{p.detail}</span></>}
        {p.running && <><br /><span className="muted">{p.itemsThisRun.toLocaleString("en-GB")} items processed in this run{p.perMinute ? ` · about ${p.perMinute.toLocaleString("en-GB")} per minute` : ""}</span></>}
      </p>
      {pct !== null && p.running && <p className="tiny muted">Estimated by date: items are read oldest first, so the share is of the time window, not of the item count.</p>}
    </div>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export function SourcesClient() {
  const { toast } = useShell();
  const [data, setData] = useState<{ connectors: Conn[]; catalog: Catalog[]; canManage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, { level: string; message: string }>>({});
  const [groupsFor, setGroupsFor] = useState<string | null>(null);
  const [foldersFor, setFoldersFor] = useState<string | null>(null);

  // Back from the Microsoft 365 sign-in: say how it went, then tidy the address bar.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("m365");
    if (!r) return;
    const [msg, tone] = r === "error" ? [`Microsoft 365 sign-in failed: ${q.get("reason") ?? "unknown error"}`, "bad" as const] : M365_RESULT[r] ?? ["", "info" as const];
    if (msg) toast(msg, tone);
    window.history.replaceState(null, "", "/sources");
  }, [toast]);

  const load = useCallback(async () => {
    const r = await fetch("/api/connectors");
    if (!r.ok) { setError("Sources couldn't be loaded."); return; }
    setData(await r.json());
  }, []);
  useEffect(() => { fetch("/api/connectors").then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setError("Sources couldn't be loaded.")); }, []);
  // Refresh while a sync is running; stops as soon as nothing is syncing.
  const syncing = data?.connectors.some((c) => c.status === "syncing");
  useEffect(() => { if (!syncing) return; const id = setTimeout(load, 3000); return () => clearTimeout(id); }, [syncing, data, load]);

  const act = async (c: Conn, action: "sync" | "full-sync" | "pause" | "resume" | "test") => {
    setBusy(c.id + action);
    try {
      const r = await fetch(`/api/connectors/${c.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? "That didn't work.", "bad"); return; }
      if (action === "test") { setTest({ ...test, [c.id]: j }); toast(j.ok ? "Connection test finished" : "Connection test failed", j.ok ? "good" : "bad"); }
      else toast({ sync: "Sync queued", "full-sync": "Full sync queued", pause: `${c.name} paused`, resume: `${c.name} resumed` }[action], action === "pause" ? "info" : "good");
      await load();
    } finally { setBusy(null); }
  };

  if (error) return <div className="page"><Callout tone="bad">{error}</Callout></div>;
  if (!data) return <div className="page"><p className="muted">Loading sources…</p></div>;
  const d = data.connectors.find((c) => c.id === detail) ?? null;
  const g = data.connectors.find((c) => c.id === groupsFor) ?? null;
  const f = data.connectors.find((c) => c.id === foldersFor) ?? null;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Sources</h1><p className="muted">Connected systems Synora indexes. Each record keeps the permissions it has in its source.</p></div>
        {data.canManage && <Btn variant="primary" icon="plus" onClick={() => setAdding(true)}>Connect a source</Btn>}
      </header>
      {!data.connectors.length && <Empty icon="plug" title="No sources yet" />}
      <div className="conn-grid">
        {data.connectors.map((c) => (
          <article key={c.id} className={"conn-card cs-" + c.status.replace(/_/g, "-")}>
            <div className="conn-top"><SourceIcon source={c.type} size={18} /><div className="grow min0"><h3 className="conn-name">{c.name}</h3><p className="muted small">{c.space} space · {SCHEDULE[c.schedule] ?? c.schedule}</p></div></div>
            <div className="conn-status"><StatusPill status={c.status} />{c.statusNote && <span className="small conn-issue">{c.statusNote}</span>}</div>
            {c.progress?.running && <SyncProgressView p={c.progress} />}
            {test[c.id] && <Callout tone={test[c.id]!.level === "ok" ? "good" : test[c.id]!.level === "warn" ? "warn" : "bad"} title={test[c.id]!.level === "error" ? "Connection test failed" : "Connection test"}>{test[c.id]!.message}</Callout>}
            {c.type === "hda" && (
              <p className="small conn-groups">
                <b>Owner groups:</b>{" "}
                {ownerGroups(c).length ? `${ownerGroups(c).slice(0, 3).map((x) => x.name).join(", ")}${ownerGroups(c).length > 3 ? ` and ${ownerGroups(c).length - 3} more` : ""}` : <span className="conn-issue">none active, so nothing is synced</span>}
              </p>
            )}
            {c.type === "m365" && (
              <p className="small conn-groups">
                <b>Microsoft 365:</b> {m365Account(c) ? `signed in as ${m365Account(c)!.name}` : <span className="conn-issue">not signed in</span>}
                <br /><b>Folders:</b>{" "}
                {folders(c).length ? `${folders(c).slice(0, 2).map((x) => x.path).join(", ")}${folders(c).length > 2 ? ` and ${folders(c).length - 2} more` : ""}` : <span className="conn-issue">none chosen, so nothing is synced</span>}
              </p>
            )}
            <dl className="conn-dl">
              <div><dt>Last sync</dt><dd>{when(c.lastSyncAt)}</dd></div>
              <div><dt>Indexed</dt><dd className="num">{fmtNum(c.recordCount)}</dd></div>
              <div><dt>Owner</dt><dd>{c.ownerGroup || "Unassigned"}</dd></div>
              <div><dt>Next sync</dt><dd>{c.status === "paused" ? "Paused" : when(c.nextSyncAt)}</dd></div>
            </dl>
            {data.canManage && (
              <div className="conn-actions">
                <Btn size="sm" icon="zap" disabled={!!busy} onClick={() => act(c, "test")}>{busy === c.id + "test" ? "Testing…" : "Test connection"}</Btn>
                {c.status !== "not_configured" && <Btn size="sm" icon="refresh" disabled={!!busy || c.status === "syncing" || c.status === "paused"} onClick={() => act(c, "sync")}>{c.status === "syncing" ? "Syncing…" : "Sync"}</Btn>}
                {c.status !== "not_configured" && <Btn size="sm" variant="ghost" icon={c.status === "paused" ? "play" : "pause"} disabled={!!busy} onClick={() => act(c, c.status === "paused" ? "resume" : "pause")}>{c.status === "paused" ? "Resume" : "Pause"}</Btn>}
                {c.type === "hda" && <Btn size="sm" variant="ghost" icon="users" disabled={!!busy} onClick={() => setGroupsFor(c.id)}>Owner groups</Btn>}
                {c.type === "m365" && !m365Account(c) && <a className="btn btn-primary btn-sm" href={`/api/connectors/${c.id}/m365/connect`}><Icon name="external" size={15} /><span>Sign in to Microsoft 365</span></a>}
                {c.type === "m365" && m365Account(c) && <Btn size="sm" variant="ghost" icon="folder" disabled={!!busy} onClick={() => setFoldersFor(c.id)}>Folders</Btn>}
                <Btn size="sm" variant="ghost" icon="eye" onClick={() => setDetail(c.id)}>Details</Btn>
              </div>
            )}
          </article>
        ))}
      </div>
      {d && <ConnectorDetail c={d} canManage={data.canManage} onFull={() => act(d, "full-sync")} onClose={() => setDetail(null)} />}
      {g && <OwnerGroupsModal c={g} onClose={() => setGroupsFor(null)} onSaved={async (msg) => { setGroupsFor(null); toast(msg, "good"); await load(); }} />}
      {f && <FolderPicker c={f} onClose={() => setFoldersFor(null)} onSaved={async (msg) => { setFoldersFor(null); toast(msg, "good"); await load(); }} onSignedOut={async () => { setFoldersFor(null); toast("Signed out of Microsoft 365.", "info"); await load(); }} />}
      {adding && <AddSource catalog={data.catalog} existing={data.connectors.map((c) => c.type)} onClose={() => setAdding(false)} onAdded={async (type) => { setAdding(false); toast(type === "ado" ? "Azure DevOps added. Set ADO_PAT, then test the connection." : "SharePoint & OneDrive added. Sign in to Microsoft 365 on its card.", "good"); await load(); }} />}
    </div>
  );
}

function ConnectorDetail({ c, canManage, onFull, onClose }: { c: Conn; canManage: boolean; onFull: () => void; onClose: () => void }) {
  const [tab, setTab] = useState("history");
  return (
    <Drawer title={c.name} onClose={onClose} wide footer={canManage && c.status !== "not_configured" ? <Btn icon="refresh" onClick={onFull} disabled={c.status === "syncing"}>Run full sync</Btn> : null}>
      <div className="row-wrap tight"><StatusPill status={c.status} /><Badge tone="neutral" icon="layers">{c.space}</Badge><Badge tone="neutral">{fmtNum(c.recordCount)} records</Badge></div>
      {c.statusNote && <Callout tone={c.status === "failed" ? "bad" : "info"}>{c.statusNote}</Callout>}
      {c.progress && <SyncProgressView p={c.progress} />}
      <Tabs label="Connector sections" value={tab} onChange={setTab} tabs={[{ value: "history", label: "Sync history", count: c.runs.length }, { value: "config", label: "Configuration" }]} />
      {tab === "history" && (c.runs.length ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>Started</th><th>Type</th><th>Result</th><th className="r">Added</th><th className="r">Updated</th><th className="r">Unchanged</th><th className="r">Removed</th></tr></thead>
          <tbody>{c.runs.map((r) => <tr key={r.id}><td>{when(r.startedAt)}</td><td>{r.kind}</td><td><StatusPill status={r.status} />{r.errorText && <div className="small muted">{r.errorText}</div>}</td><td className="r num">{r.added}</td><td className="r num">{r.updated}</td><td className="r num">{r.unchanged}</td><td className="r num">{r.deleted}</td></tr>)}</tbody></table></div>
      ) : <p className="muted small">No syncs yet.</p>)}
      {tab === "config" && (
        <dl className="rd-dl">
          <dt>Type</dt><dd>{c.type}</dd>
          <dt>Default space</dt><dd>{c.space}</dd>
          <dt>Schedule</dt><dd>{SCHEDULE[c.schedule] ?? c.schedule}</dd>
          <dt>Owner group</dt><dd>{c.ownerGroup || "Unassigned"}</dd>
          <dt>Secret</dt><dd className="mono">{c.secretRef ? `${c.secretRef} (value never shown)` : "None"}</dd>
          {c.type === "m365" && <><dt>Microsoft 365 account</dt><dd>{m365Account(c) ? `${m365Account(c)!.name} (${m365Account(c)!.upn})` : "Not signed in"}</dd><dt>Folders</dt><dd>{folders(c).length ? folders(c).map((x) => `${x.path}${x.approved ? " (approved knowledge)" : ""}`).join(", ") : "None"}</dd><dt>Settings</dt><dd className="mono">config/m365-mapping.json</dd></>}
          {Object.entries(c.config).filter(([k]) => !["ownerGroups", "folders", "account"].includes(k)).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{String(v) || "—"}</dd></Fragment>)}
          {c.type === "hda" && <><dt>Active owner groups</dt><dd>{ownerGroups(c).length ? ownerGroups(c).map((x) => `${x.name} (${x.id})`).join(", ") : "None"}</dd></>}
          {c.type === "hda" && <><dt>Field mapping</dt><dd className="mono">config/hda-mapping.json</dd><dt>Spaces by ticket type</dt><dd>IT Support, HR (owner group only), Retail, Shared Services, Facilities. Security incidents and report leaks are never indexed.</dd></>}
        </dl>
      )}
      <p className="muted small">Last updated {fmtDate(c.lastSyncAt)}.</p>
    </Drawer>
  );
}

/** Search HDA owner groups and choose which ones Synora indexes. Only their tickets are synced and shown. */
function OwnerGroupsModal({ c, onClose, onSaved }: { c: Conn; onClose: () => void; onSaved: (message: string) => void }) {
  const { toast } = useShell();
  const [active, setActive] = useState<OwnerGroup[]>(ownerGroups(c));
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OwnerGroup[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const before = ownerGroups(c);
  const removed = before.filter((b) => !active.some((a) => a.id === b.id));
  const changed = removed.length > 0 || active.some((a) => !before.some((b) => b.id === a.id));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/connectors/${c.id}/owner-groups?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setError(j.error ?? "Owner groups couldn't be searched."); setResults(null); } else { setError(null); setResults(j.results); }
      } catch { /* superseded by a newer search */ } finally { setSearching(false); }
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, c.id]);
  const shown = q.trim().length >= 2 ? results : null;

  const toggle = (g: OwnerGroup) => setActive((cur) => (cur.some((x) => x.id === g.id) ? cur.filter((x) => x.id !== g.id) : [...cur, g]));
  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/connectors/${c.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "owner-groups", groups: active }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? "The owner groups couldn't be saved.", "bad"); return; }
      onSaved([`${active.length} owner group${active.length === 1 ? "" : "s"} active.`, j.recordsRemoved ? `${fmtNum(j.recordsRemoved)} tickets of other groups removed from Synora.` : "", j.syncQueued ? "A sync of the new groups is queued." : ""].filter(Boolean).join(" "));
    } finally { setSaving(false); }
  };

  return (
    <Modal title="HDA owner groups" subtitle="Only tickets owned by the active groups are synced and searchable." onClose={onClose} size="lg"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="check" disabled={!changed || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Btn></>}>
      <div className="og-wrap">
        <div>
          <span className="eyebrow">Active ({active.length})</span>
          {active.length
            ? <div className="chip-row tight">{active.map((g) => <span key={g.id} className="fchip" title={g.id}>{g.name}<button type="button" aria-label={`Deactivate ${g.name}`} onClick={() => toggle(g)}>×</button></span>)}</div>
            : <p className="muted small">No group is active, so HDA isn&apos;t synced.</p>}
        </div>
        <label className="og-search">
          <span className="eyebrow">Find a group</span>
          <input className="input" type="search" placeholder="Group name or id, e.g. RxIT or G815L" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {error && shown !== null && <Callout tone="bad">{error}</Callout>}
        {searching && <p className="muted small">Searching HDA groups…</p>}
        {shown && !shown.length && !searching && <p className="muted small">No group matches “{q.trim()}”.</p>}
        {shown && shown.length > 0 && (
          <ul className="rec-list og-results">{shown.map((g) => {
            const on = active.some((x) => x.id === g.id);
            return (
              <li key={g.id} className="rec-row">
                <span className="grow min0"><b>{g.name}</b> <span className="muted small mono">{g.id}</span></span>
                <Btn size="sm" variant={on ? "ghost" : "primary"} icon={on ? "x" : "plus"} onClick={() => toggle(g)}>{on ? "Deactivate" : "Activate"}</Btn>
              </li>
            );
          })}</ul>
        )}
        {removed.length > 0 && <Callout tone="warn" title="Tickets will be removed">Saving removes the tickets of {removed.map((x) => x.name).join(", ")} from Synora. They stay in HDA and come back if the group is activated again.</Callout>}
      </div>
    </Modal>
  );
}

interface Level { driveId: string; itemId: string; name: string; path: string; source: Folder["source"] }
interface Roots { site: { name: string; webUrl: string; libraries: { driveId: string; name: string }[] } | null; siteError: string | null; siteUrl: string; onedrive: { driveId: string; name: string } | null }

/** Browse SharePoint libraries and OneDrive as the signed-in Microsoft 365 account, and choose folders to index. */
function FolderPicker({ c, onClose, onSaved, onSignedOut }: { c: Conn; onClose: () => void; onSaved: (message: string) => void; onSignedOut: () => void }) {
  const { toast } = useShell();
  const [chosen, setChosen] = useState<Folder[]>(folders(c));
  const [siteUrl, setSiteUrl] = useState(String(c.config.siteUrl ?? ""));
  const [roots, setRoots] = useState<Roots | null>(null);
  const [stack, setStack] = useState<Level[]>([]);
  const [listing, setListing] = useState<{ folders: { itemId: string; name: string; childCount: number }[]; fileCount: number; rootId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const here = stack[stack.length - 1] ?? null;
  const key = (x: { driveId: string; itemId: string }) => `${x.driveId}:${x.itemId}`;

  const browse = useCallback(async (query: string) => {
    try {
      const r = await fetch(`/api/connectors/${c.id}/m365/browse?${query}`);
      const j = await r.json().catch(() => ({}));
      setError(r.ok ? null : j.error ?? "Microsoft 365 couldn't be browsed.");
      return r.ok ? j : null;
    } catch { setError("Microsoft 365 couldn't be browsed."); return null; } finally { setLoading(false); }
  }, [c.id]);
  // The site's libraries and OneDrive when the picker opens; folders are loaded as you open them.
  useEffect(() => {
    fetch(`/api/connectors/${c.id}/m365/browse?site=${encodeURIComponent(String(c.config.siteUrl ?? ""))}`)
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => { if (ok) setRoots(j); else setError(j.error ?? "Microsoft 365 couldn't be browsed."); })
      .catch(() => setError("Microsoft 365 couldn't be browsed."))
      .finally(() => setLoading(false));
  }, [c.id, c.config.siteUrl]);
  const loadRoots = async (url: string) => {
    setLoading(true); setStack([]); setListing(null);
    const j = await browse(`site=${encodeURIComponent(url)}`);
    if (j) setRoots(j);
  };
  const goTo = async (next: Level[]) => {
    setStack(next); setListing(null);
    const lvl = next[next.length - 1];
    if (!lvl) return;
    setLoading(true);
    const j = await browse(`drive=${encodeURIComponent(lvl.driveId)}&item=${encodeURIComponent(lvl.itemId)}`);
    if (j) setListing(j);
  };
  const open = (lvl: Level) => void goTo([...stack, lvl]);
  const choose = (x: Folder) => setChosen((cur) => (cur.some((y) => key(y) === key(x)) ? cur : [...cur, x]));
  const current = (): Folder | null => (here && listing ? { driveId: here.driveId, itemId: listing.rootId, name: here.name, path: here.path, source: here.source } : null);
  const before = folders(c);
  const changed = JSON.stringify(chosen) !== JSON.stringify(before) || siteUrl !== String(c.config.siteUrl ?? "");
  const removed = before.filter((b) => !chosen.some((x) => key(x) === key(b)));

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/connectors/${c.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "folders", folders: chosen, siteUrl }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? "The folders couldn't be saved.", "bad"); return; }
      onSaved([`${chosen.length} folder${chosen.length === 1 ? "" : "s"} chosen.`, j.recordsRemoved ? `${fmtNum(j.recordsRemoved)} documents of removed folders left Synora.` : "", j.syncQueued ? "A sync is queued." : ""].filter(Boolean).join(" "));
    } finally { setSaving(false); }
  };
  const signOut = async () => {
    const r = await fetch(`/api/connectors/${c.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "m365-signout" }) });
    if (r.ok) onSignedOut(); else toast("Couldn't sign out.", "bad");
  };

  return (
    <Modal title="SharePoint & OneDrive folders" subtitle={`Synora reads the chosen folders and everything below them, as ${m365Account(c)?.name ?? "the signed-in account"}.`} onClose={onClose} size="lg"
      footer={<><Btn variant="ghost" onClick={signOut}>Sign out of Microsoft 365</Btn><span className="grow" /><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="check" disabled={!changed || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Btn></>}>
      <div className="og-wrap">
        <div>
          <span className="eyebrow">Chosen folders ({chosen.length})</span>
          {chosen.length ? (
            <ul className="rec-list">{chosen.map((x) => (
              <li key={key(x)} className="rec-row">
                <span className="grow min0"><b>{x.path}</b> <span className="muted small">{x.source === "onedrive" ? "OneDrive" : "SharePoint"}</span></span>
                <label className="small row-wrap tight" title="Documents in this folder count as approved knowledge in answers"><input type="checkbox" checked={!!x.approved} onChange={(e) => setChosen((cur) => cur.map((y) => (key(y) === key(x) ? { ...y, approved: e.target.checked } : y)))} /> Approved knowledge</label>
                <Btn size="sm" variant="ghost" icon="x" onClick={() => setChosen((cur) => cur.filter((y) => key(y) !== key(x)))}>Remove</Btn>
              </li>
            ))}</ul>
          ) : <p className="muted small">No folder chosen yet. Browse below and choose one.</p>}
        </div>

        <form className="og-search" onSubmit={(e) => { e.preventDefault(); void loadRoots(siteUrl.trim()); }}>
          <span className="eyebrow">SharePoint site</span>
          <div className="row-wrap tight"><input className="input grow" type="url" placeholder="https://contoso.sharepoint.com/sites/Team" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} /><Btn type="submit" size="sm">Open site</Btn></div>
        </form>

        <div>
          <div className="row-wrap tight small">
            <button type="button" className="link-btn" onClick={() => void goTo([])}>Libraries</button>
            {stack.map((l, i) => <Fragment key={`${l.driveId}:${l.itemId}`}><span className="muted">/</span><button type="button" className="link-btn" onClick={() => void goTo(stack.slice(0, i + 1))}>{l.name}</button></Fragment>)}
          </div>
          {error && <Callout tone="bad">{error}</Callout>}
          {loading && <p className="muted small">Loading…</p>}
          {!here && roots && !loading && (
            <ul className="rec-list og-results">
              {roots.siteError && <li className="rec-row"><span className="conn-issue small">{roots.siteError}</span></li>}
              {roots.site?.libraries.map((lib) => (
                <li key={lib.driveId} className="rec-row"><span className="grow min0"><b>{lib.name}</b> <span className="muted small">{roots.site!.name}</span></span>
                  <Btn size="sm" icon="folder" onClick={() => open({ driveId: lib.driveId, itemId: "root", name: lib.name, path: `${roots.site!.name}/${lib.name}`, source: "sharepoint" })}>Open</Btn></li>
              ))}
              {roots.onedrive && (
                <li className="rec-row"><span className="grow min0"><b>My OneDrive</b> <span className="muted small">{m365Account(c)?.name}</span></span>
                  <Btn size="sm" icon="folder" onClick={() => open({ driveId: roots.onedrive!.driveId, itemId: "root", name: "My OneDrive", path: "OneDrive", source: "onedrive" })}>Open</Btn></li>
              )}
            </ul>
          )}
          {here && listing && !loading && (
            <>
              <div className="row-wrap tight" style={{ margin: "8px 0" }}>
                <span className="small muted grow">{listing.folders.length} folders · {listing.fileCount} files here</span>
                <Btn size="sm" variant="primary" icon="check" disabled={chosen.some((x) => current() && key(x) === key(current()!))} onClick={() => current() && choose(current()!)}>Choose this folder</Btn>
              </div>
              <ul className="rec-list og-results">{listing.folders.map((x) => {
                const lvl: Level = { driveId: here.driveId, itemId: x.itemId, name: x.name, path: `${here.path}/${x.name}`, source: here.source };
                const on = chosen.some((y) => key(y) === key(lvl));
                return (
                  <li key={x.itemId} className="rec-row">
                    <span className="grow min0"><b>{x.name}</b> <span className="muted small">{x.childCount} items</span></span>
                    <Btn size="sm" variant="ghost" icon="folder" onClick={() => open(lvl)}>Open</Btn>
                    <Btn size="sm" variant={on ? "ghost" : "primary"} icon={on ? "check" : "plus"} disabled={on} onClick={() => choose({ ...lvl })}>{on ? "Chosen" : "Choose"}</Btn>
                  </li>
                );
              })}</ul>
              {!listing.folders.length && <p className="muted small">No sub-folders here.</p>}
            </>
          )}
        </div>
        {removed.length > 0 && <Callout tone="warn" title="Documents will be removed">Saving removes the documents of {removed.map((x) => x.path).join(", ")} from Synora. The files stay in Microsoft 365.</Callout>}
      </div>
    </Modal>
  );
}

function AddSource({ catalog, existing, onClose, onAdded }: { catalog: Catalog[]; existing: string[]; onClose: () => void; onAdded: (type: string) => void }) {
  const { toast } = useShell();
  const [pick, setPick] = useState<Catalog | null>(null);
  const [adding, setAdding] = useState(false);
  const add = async (type: "ado" | "m365") => {
    setAdding(true);
    try {
      const r = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? "The source couldn't be added.", "bad"); return; }
      onAdded(type);
    } finally { setAdding(false); }
  };
  const m365 = pick?.type === "sharepoint" || pick?.type === "onedrive";
  return (
    <Modal title="Connect a source" subtitle={pick ? pick.name : "Choose a source type"} onClose={onClose} size="lg" footer={<Btn variant="ghost" onClick={pick ? () => setPick(null) : onClose}>{pick ? "Back" : "Close"}</Btn>}>
      {!pick && <div className="type-grid">{catalog.map((x) => (
        <button key={x.type} type="button" className="type-card" onClick={() => setPick(x)}>
          <SourceIcon source={x.type} size={17} /><span><b>{x.name}</b><span className="muted small">{x.description}</span></span>
          {!x.available && <span className="type-check"><Badge tone="muted">Coming next</Badge></span>}
        </button>
      ))}</div>}
      {pick?.type === "hda" && (
        <div className="panel-inner">
          <p>The HDA connector is set up already. To switch it on:</p>
          <ol className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>In <code>.env</code>, set <code>HDA_USERNAME</code> and <code>HDA_PASSWORD</code> for the HDA API user. Never use a personal account in production.</li>
            <li>Connect to the company VPN; HDA is only reachable on the corporate network.</li>
            <li>Run <code>npm run hda:discover</code> to check every mapped field comes back filled.</li>
            <li>On the HDA card, choose <b>Owner groups</b> and activate the groups whose tickets Synora should index.</li>
            <li>Choose <b>Test connection</b>, then <b>Sync</b>.</li>
          </ol>
        </div>
      )}
      {pick?.type === "ado" && (
        <div className="panel-inner">
          <p>Indexes the work items of one Azure DevOps project (bugs, user stories, tasks, features…) with all their fields and comments, plus the project wikis, in the Development space.</p>
          <ol className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>In Azure DevOps, create a personal access token (User settings → Personal access tokens) with only the <b>Work Items (Read)</b> and <b>Wiki (Read)</b> scopes.</li>
            <li>In <code>.env</code>, set <code>ADO_PAT</code>, and check <code>ADO_ORG_URL</code> and <code>ADO_PROJECT</code>. For production, use <code>ADO_AUTH_MODE=entra</code> with a service principal instead of a personal token.</li>
            <li>Restart the web app and the sync worker so they read the token.</li>
            <li>On the Azure DevOps card, choose <b>Test connection</b>, then <b>Sync</b>.</li>
          </ol>
          {existing.includes("ado")
            ? <Callout tone="info">Azure DevOps is already in the list of sources.</Callout>
            : <Btn variant="primary" icon="plus" disabled={adding} onClick={() => add("ado")}>{adding ? "Adding…" : "Add Azure DevOps"}</Btn>}
        </div>
      )}
      {m365 && (
        <div className="panel-inner">
          <p>One source covers both: it reads the folders you choose in SharePoint sites and in your OneDrive, as the Microsoft 365 account that signs in. Word, Excel, PowerPoint (old and new), PDF, Markdown, text, HTML, images (with text recognition) and draw.io diagrams are indexed.</p>
          <ol className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>IT registers the app in Entra ID (delegated permissions <code>Files.Read.All</code>, <code>Sites.Read.All</code>, <code>offline_access</code>, <code>User.Read</code>; redirect URI <code>{"<app address>"}/api/connectors/m365/callback</code>) and gives you the tenant ID, client ID and secret.</li>
            <li>In <code>.env</code>, set <code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code>, <code>M365_CLIENT_SECRET</code> and <code>M365_SITE_URL</code>, then restart the web app and the worker.</li>
            <li>On the SharePoint &amp; OneDrive card, choose <b>Sign in to Microsoft 365</b>, then <b>Folders</b> to pick what Synora reads.</li>
          </ol>
          {existing.includes("m365")
            ? <Callout tone="info">SharePoint &amp; OneDrive is already in the list of sources.</Callout>
            : <Btn variant="primary" icon="plus" disabled={adding} onClick={() => add("m365")}>{adding ? "Adding…" : "Add SharePoint & OneDrive"}</Btn>}
        </div>
      )}
      {pick && pick.type !== "hda" && pick.type !== "ado" && !m365 && (
        <Callout tone="info" title={pick.available ? "Already connected" : `${pick.name} is coming next`}>
          {pick.available ? "This source is already in the list." : "The connector framework is in place; this source type is planned in the next build phase."}
        </Callout>
      )}
    </Modal>
  );
}

