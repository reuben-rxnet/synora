"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { fmtDate, useShell } from "./shell";
import { Badge, Btn, Callout, Drawer, Empty, Modal, SourceIcon, StatusPill, Tabs, fmtNum } from "./ui";

interface Run { id: string; kind: string; status: string; startedAt: string; finishedAt: string | null; added: number; updated: number; unchanged: number; deleted: number; failed: number; errorText: string | null }
interface Conn { id: string; type: string; name: string; space: string; status: string; statusNote: string | null; schedule: string; ownerGroup: string; lastSyncAt: string | null; nextSyncAt: string | null; recordCount: number; config: Record<string, unknown>; secretRef: string | null; runs: Run[] }
interface Catalog { type: string; name: string; category: string; description: string; available: boolean }

const SCHEDULE: Record<string, string> = { "15min": "Every 15 minutes", hourly: "Hourly", "6h": "Every 6 hours", daily: "Daily", manual: "Manual only" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export function SourcesClient() {
  const { toast } = useShell();
  const [data, setData] = useState<{ connectors: Conn[]; catalog: Catalog[]; canManage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, { level: string; message: string }>>({});

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
                <Btn size="sm" variant="ghost" icon="eye" onClick={() => setDetail(c.id)}>Details</Btn>
              </div>
            )}
          </article>
        ))}
      </div>
      {d && <ConnectorDetail c={d} canManage={data.canManage} onFull={() => act(d, "full-sync")} onClose={() => setDetail(null)} />}
      {adding && <AddSource catalog={data.catalog} onClose={() => setAdding(false)} />}
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
          {Object.entries(c.config).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{String(v) || "—"}</dd></Fragment>)}
          {c.type === "hda" && <><dt>Field mapping</dt><dd className="mono">config/hda-mapping.json</dd><dt>Spaces by ticket type</dt><dd>IT Support, HR (owner group only), Retail, Shared Services, Facilities. Security incidents and report leaks are never indexed.</dd></>}
        </dl>
      )}
      <p className="muted small">Last updated {fmtDate(c.lastSyncAt)}.</p>
    </Drawer>
  );
}

function AddSource({ catalog, onClose }: { catalog: Catalog[]; onClose: () => void }) {
  const [pick, setPick] = useState<Catalog | null>(null);
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
          <p>The HDA connector is set up already (it uses the same HDA API as CSAT Pulse). To switch it on:</p>
          <ol className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>In <code>.env</code>, set <code>HDA_USERNAME</code> and <code>HDA_PASSWORD</code> for the HDA API user. Never use a personal account in production.</li>
            <li>Connect to the company VPN; HDA is only reachable on the corporate network.</li>
            <li>Run <code>npm run hda:discover</code> to check every mapped field comes back filled.</li>
            <li>On the HDA card, choose <b>Test connection</b>, then <b>Sync</b>.</li>
          </ol>
        </div>
      )}
      {pick && pick.type !== "hda" && (
        <Callout tone="info" title={pick.available ? "Already connected" : `${pick.name} is coming next`}>
          {pick.available ? "This source is already in the list." : "The connector framework is in place; this source type is planned in the next build phase."}
        </Callout>
      )}
    </Modal>
  );
}

