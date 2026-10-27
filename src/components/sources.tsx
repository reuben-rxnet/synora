"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { fmtDate, useShell } from "./shell";
import { Badge, Btn, Callout, Drawer, Empty, Modal, SourceIcon, StatusPill, Tabs, fmtNum } from "./ui";

interface Run { id: string; kind: string; status: string; startedAt: string; finishedAt: string | null; added: number; updated: number; unchanged: number; deleted: number; failed: number; errorText: string | null }
interface Conn { id: string; type: string; name: string; space: string; status: string; statusNote: string | null; schedule: string; ownerGroup: string; lastSyncAt: string | null; nextSyncAt: string | null; recordCount: number; config: Record<string, unknown>; secretRef: string | null; runs: Run[] }
interface OwnerGroup { id: string; name: string }
interface Catalog { type: string; name: string; category: string; description: string; available: boolean }

const SCHEDULE: Record<string, string> = { "15min": "Every 15 minutes", hourly: "Hourly", "6h": "Every 6 hours", daily: "Daily", manual: "Manual only" };
const ownerGroups = (c: Conn): OwnerGroup[] => (Array.isArray(c.config.ownerGroups) ? (c.config.ownerGroups as OwnerGroup[]) : []);
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
            {test[c.id] && <Callout tone={test[c.id]!.level === "ok" ? "good" : test[c.id]!.level === "warn" ? "warn" : "bad"} title={test[c.id]!.level === "error" ? "Connection test failed" : "Connection test"}>{test[c.id]!.message}</Callout>}
            {c.type === "hda" && (
              <p className="small conn-groups">
                <b>Owner groups:</b>{" "}
                {ownerGroups(c).length ? `${ownerGroups(c).slice(0, 3).map((x) => x.name).join(", ")}${ownerGroups(c).length > 3 ? ` and ${ownerGroups(c).length - 3} more` : ""}` : <span className="conn-issue">none active, so nothing is synced</span>}
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
                <Btn size="sm" variant="ghost" icon="eye" onClick={() => setDetail(c.id)}>Details</Btn>
              </div>
            )}
          </article>
        ))}
      </div>
      {d && <ConnectorDetail c={d} canManage={data.canManage} onFull={() => act(d, "full-sync")} onClose={() => setDetail(null)} />}
      {g && <OwnerGroupsModal c={g} onClose={() => setGroupsFor(null)} onSaved={async (msg) => { setGroupsFor(null); toast(msg, "good"); await load(); }} />}
      {adding && <AddSource catalog={data.catalog} existing={data.connectors.map((c) => c.type)} onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); toast("Azure DevOps added. Set ADO_PAT, then test the connection.", "good"); await load(); }} />}
    </div>
  );
}

function ConnectorDetail({ c, canManage, onFull, onClose }: { c: Conn; canManage: boolean; onFull: () => void; onClose: () => void }) {
  const [tab, setTab] = useState("history");
  return (
    <Drawer title={c.name} onClose={onClose} wide footer={canManage && c.status !== "not_configured" ? <Btn icon="refresh" onClick={onFull} disabled={c.status === "syncing"}>Run full sync</Btn> : null}>
      <div className="row-wrap tight"><StatusPill status={c.status} /><Badge tone="neutral" icon="layers">{c.space}</Badge><Badge tone="neutral">{fmtNum(c.recordCount)} records</Badge></div>
      {c.statusNote && <Callout tone={c.status === "failed" ? "bad" : "info"}>{c.statusNote}</Callout>}
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
          {Object.entries(c.config).filter(([k]) => k !== "ownerGroups").map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{String(v) || "—"}</dd></Fragment>)}
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

function AddSource({ catalog, existing, onClose, onAdded }: { catalog: Catalog[]; existing: string[]; onClose: () => void; onAdded: () => void }) {
  const { toast } = useShell();
  const [pick, setPick] = useState<Catalog | null>(null);
  const [adding, setAdding] = useState(false);
  const addAdo = async () => {
    setAdding(true);
    try {
      const r = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "ado" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.error ?? "Azure DevOps couldn't be added.", "bad"); return; }
      onAdded();
    } finally { setAdding(false); }
  };
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
            : <Btn variant="primary" icon="plus" disabled={adding} onClick={addAdo}>{adding ? "Adding…" : "Add Azure DevOps"}</Btn>}
        </div>
      )}
      {pick && pick.type !== "hda" && pick.type !== "ado" && (
        <Callout tone="info" title={pick.available ? "Already connected" : `${pick.name} is coming next`}>
          {pick.available ? "This source is already in the list." : "The connector framework is in place; this source type is planned in the next build phase."}
        </Callout>
      )}
    </Modal>
  );
}

