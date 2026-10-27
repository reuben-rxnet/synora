"use client";
import { useEffect, useState } from "react";
import type { RecordCard, SearchEvent } from "@/lib/search/pipeline";
import { fmtDate, typeText, useShell } from "./shell";
import { Badge, Btn, Callout, Empty, Icon, KindBadge, Modal, Similarity, SourceIcon, StatusPill } from "./ui";

type Similar = RecordCard & { why: string[] };

async function findSimilar(query: string, sourceSystems: string[]): Promise<Similar[]> {
  const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, mode: "similar", filters: sourceSystems.length ? { sourceSystems } : {} }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Search failed.");
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as SearchEvent);
  const err = lines.find((e) => e.type === "error");
  if (err && err.type === "error") throw new Error(err.message);
  const s = lines.find((e) => e.type === "similar");
  return s && s.type === "similar" ? s.records : [];
}

const STOP = new Set("the and for with after again from that this have been into when then they them their there were was are but not out".split(" "));
const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? []).filter((w) => !STOP.has(w)));
const TEMPORARY = /\b(restart|reboot|re-?ran|retry|temporar)/i;

export function SimilarClient({ initialQuery, sourceSystems }: { initialQuery: string; sourceSystems: string[] }) {
  const [desc, setDesc] = useState(initialQuery);
  const [sources, setSources] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(80);
  const [results, setResults] = useState<Similar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<Similar | null>(null);
  const { openRecord, toast } = useShell();

  const run = async () => {
    if (desc.trim().length < 2) return;
    setLoading(true); setError(null);
    try { setResults(await findSimilar(desc.trim(), sources)); } catch (e) { setError(e instanceof Error ? e.message : "Search failed."); } finally { setLoading(false); }
  };
  // Runs once when the page is opened with a description (from Search → Similar issues).
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (initialQuery) void run(); }, []);

  const shown = (results ?? []).filter((r) => r.similarity >= threshold);
  const pin = async (r: Similar) => {
    const res = await fetch("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "record", name: `${r.ref} – ${r.title.slice(0, 60)}`, recordId: r.id, tags: ["similar"] }) });
    toast(res.ok ? "Pinned. Find it under Saved." : "Couldn't pin this record.", res.ok ? "good" : "bad");
  };

  return (
    <div className="page">
      <header className="page-head"><div><h1>Similar Issues</h1><p className="muted">Compare a current incident with historical tickets, bugs and discussions you can access.</p></div></header>
      <div className="similar-layout">
        <form className="panel sim-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <label className="label" htmlFor="sim-desc">Incident description</label>
          <textarea id="sim-desc" className="input" rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Symptoms, timing, environment, error messages…" />
          <fieldset><legend className="label">Sources</legend>
            <div className="chip-row">{sourceSystems.map((s) => (
              <button key={s} type="button" className={"chip " + (sources.includes(s) ? "chip-on" : "")} aria-pressed={sources.includes(s)} onClick={() => setSources(sources.includes(s) ? sources.filter((x) => x !== s) : sources.concat(s))}>{sources.includes(s) && <Icon name="check" size={13} />}{s}</button>
            ))}</div>
            <p className="hint">None selected searches all sources.</p>
          </fieldset>
          <label className="label" htmlFor="sim-th">Similarity threshold <b className="num">{threshold}%</b></label>
          <input id="sim-th" type="range" min="70" max="95" step="1" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
          <Btn variant="primary" icon="search" type="submit" disabled={desc.trim().length < 2 || loading}>{loading ? "Finding similar issues…" : "Find similar issues"}</Btn>
        </form>
        <section className="sim-results" aria-live="polite" aria-busy={loading}>
          {error && <Callout tone="bad" title="Search failed">{error}</Callout>}
          {loading && [0, 1, 2].map((i) => <div key={i} className="skeleton-card" />)}
          {!loading && results === null && !error && <Empty icon="similar" title="Describe the incident">Synora ranks historical issues by symptoms, errors and application, and explains why each one matches.</Empty>}
          {!loading && results !== null && (
            <div className="row-between"><h2 className="h3">{shown.length} similar issue{shown.length === 1 ? "" : "s"} at {threshold}% or above</h2><Badge tone="info" icon="info">Ranked by description, terms and application</Badge></div>
          )}
          {!loading && results !== null && !shown.length && <Empty icon="similar" title="No similar issues above this threshold" action={results.length ? <Btn onClick={() => setThreshold(70)}>Lower threshold to 70%</Btn> : undefined}>Try a lower threshold, more sources, or a fuller description with error messages.</Empty>}
          {!loading && shown.map((r, i) => (
            <article key={r.id} className="sim-card">
              <div className="sim-card-top">
                <span className="rank">#{i + 1}</span><Similarity value={r.similarity} />
                <div className="grow min0"><div className="row-wrap tight"><span className="mono">{r.ref}</span>{r.status && <StatusPill status={r.status} />}<KindBadge kind={r.evidenceKind} /></div><h3 className="sim-title">{r.title}</h3></div>
              </div>
              <dl className="meta-grid">
                <div><dt>Source</dt><dd><SourceIcon source={r.sourceSystem} size={13} />{r.sourceSystem}</dd></div>
                <div><dt>Type</dt><dd>{typeText(r.recordType)}</dd></div>
                {r.application && <div><dt>Application</dt><dd>{r.application}</dd></div>}
                {r.location && <div><dt>Location</dt><dd>{r.location}</dd></div>}
                <div><dt>Date</dt><dd>{fmtDate(r.updatedAt)}</dd></div>
                {r.links.length > 0 && <div><dt>Linked</dt><dd>{r.links.join(", ")}</dd></div>}
              </dl>
              <div className="rc-grid">
                <div><span className="eyebrow">Root cause</span><p>{r.rootCause || "Not documented"}</p></div>
                <div><span className="eyebrow">Resolution</span><p>{r.resolution || "None recorded"}</p></div>
              </div>
              {r.why.length > 0 && <div className="why"><span className="eyebrow">Why Synora considers it similar</span><ul className="why-list">{r.why.map((w) => <li key={w}><Icon name="check" size={13} />{w}</li>)}</ul></div>}
              <div className="row-end">
                <Btn size="sm" variant="ghost" icon="eye" onClick={() => openRecord(r.id)}>Open source</Btn>
                <Btn size="sm" icon="bookmark" onClick={() => pin(r)}>Pin</Btn>
                <Btn size="sm" variant="primary" icon="similar" onClick={() => setCompare(r)}>View comparison</Btn>
              </div>
            </article>
          ))}
        </section>
      </div>
      {compare && <CompareModal current={desc} h={compare} onClose={() => setCompare(null)} />}
    </div>
  );
}

function CompareModal({ current, h, onClose }: { current: string; h: Similar; onClose: () => void }) {
  const { openRecord } = useShell();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const mine = words(current);
  const theirs = words(`${h.title} ${h.excerpt} ${h.rootCause ?? ""}`);
  const shared = [...mine].filter((w) => theirs.has(w)).slice(0, 12);
  const onlyMine = [...mine].filter((w) => !theirs.has(w)).slice(0, 8);
  const temporary = TEMPORARY.test(h.resolution ?? "") && !(h.rootCause && /^(resolved|closed)$/i.test(h.status ?? ""));
  const risk = temporary ? "High" : !h.rootCause ? "Medium" : "Low";
  const riskNote = temporary ? "The previous fix only restored service for a while. Reusing it will not prevent recurrence."
    : !h.rootCause ? "No root cause was recorded, so it's unclear whether the previous fix addressed the cause." : "A root cause was recorded. Confirm it applies to the current environment before reusing the fix.";
  const validation = ["Confirm the same error messages appear in the current logs", "Compare environment, version and location", temporary ? "Capture resource and connection metrics before any restart" : "Check the previous root cause against current data", "Agree the change with the owner group"];
  return (
    <Modal title="Issue comparison" subtitle={`Current issue vs. ${h.ref}`} onClose={onClose} size="xl"
      footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn icon="eye" onClick={() => openRecord(h.id)}>Open {h.ref}</Btn></>}>
      <div className="compare-cols">
        <div className="cmp-col cur"><span className="eyebrow">Current issue</span><p>{current.slice(0, 400)}</p></div>
        <div className="cmp-col hist"><span className="eyebrow">Historical issue</span><h3>{h.title}</h3><p className="muted small"><span className="mono">{h.ref}</span> · {h.sourceSystem}{h.application ? ` · ${h.application}` : ""}{h.location ? ` · ${h.location}` : ""} · {fmtDate(h.updatedAt)}</p></div>
      </div>
      <div className="cmp-rows">
        <div className="cmp-row cr-good"><span className="cmp-label">Shared terms</span><ul className="cmp-val">{shared.length ? <li><Icon name="check" size={13} />{shared.join(", ")}</li> : <li className="muted">No shared terms</li>}</ul></div>
        <div className="cmp-row cr-warn"><span className="cmp-label">Only in the current issue</span><ul className="cmp-val">{onlyMine.length ? <li><Icon name="alert" size={13} />{onlyMine.join(", ")}</li> : <li className="muted">Nothing notable</li>}</ul></div>
        <div className="cmp-row"><span className="cmp-label">Why it matched</span><ul className="cmp-val">{h.why.map((w) => <li key={w}>{w}</li>)}</ul></div>
        <div className="cmp-row"><span className="cmp-label">Previous root cause</span><ul className="cmp-val"><li>{h.rootCause || "Not documented"}</li></ul></div>
        <div className="cmp-row"><span className="cmp-label">Previous resolution</span><ul className="cmp-val"><li>{h.resolution || "None recorded"}</li></ul></div>
      </div>
      <div className={"reuse c-" + ({ High: "bad", Medium: "warn", Low: "good" }[risk])}><div><span className="eyebrow">Reuse risk</span><b>{risk}</b></div><p>{riskNote}</p></div>
      <div className="panel-inner"><span className="eyebrow">Required validation</span>
        <ul className="check-list">{validation.map((v) => <li key={v}><label className="check"><input type="checkbox" checked={!!done[v]} onChange={() => setDone({ ...done, [v]: !done[v] })} />{v}</label></li>)}</ul>
      </div>
      <Callout tone="info" title="Validate before applying">Synora never applies a previous resolution automatically. Complete the validation and agree the change with the owner group.</Callout>
    </Modal>
  );
}
