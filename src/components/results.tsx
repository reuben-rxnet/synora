"use client";
// The answer-first results view (Design Reference/Synora Enterprise AI Search Dashboard.png): the answer panel,
// the evidence panel with source filters, related issues and follow-up questions. Everything shown comes from the
// search events; an indicator is only shown when the data behind it supports it.
import { useState } from "react";
import type { AnswerBody, Confidence } from "@/lib/search/answer";
import type { RecordCard, RelatedIssue, SourceCoverage, Trust } from "@/lib/search/pipeline";
import { fmtDate, typeText, useShell } from "./shell";
import { Badge, Btn, Callout, Empty, Icon, KindBadge, StatusPill } from "./ui";

export type ResultTab = "answer" | "evidence" | "related" | "followups";
export interface AnswerData { body: AnswerBody; confidence: Confidence; provider: string; note: string | null; trust: Trust }

const GROUP_ICON: Record<string, string> = { hda: "ticket", ado: "bug", "ado-wiki": "book", sharepoint: "layers", onedrive: "folder", demo: "file", other: "file" };
const GROUP_SHORT: Record<string, string> = { hda: "HDA", ado: "Azure DevOps", "ado-wiki": "Azure DevOps Wiki", sharepoint: "SharePoint", onedrive: "OneDrive", demo: "Demo data", other: "Other" };
const OPEN_IN: Record<string, string> = { hda: "Open in HDA", ado: "Open in Azure DevOps", "ado-wiki": "Open wiki page", sharepoint: "Open document", onedrive: "Open in OneDrive" };
const RELEVANCE: Record<string, [string, string]> = { exact: ["Exact reference", "good"], strong: ["Strong match", "info"], related: ["Related", "neutral"], weak: ["Weak match", "muted"] };
const ROLE_TONE: Record<string, string> = {
  direct: "info", "confirmed-resolution": "good", "temporary-workaround": "warn", "authoritative-doc": "good", documentation: "neutral",
  investigation: "violet", "development-work": "violet", "similar-incident": "neutral", background: "muted",
};

/** Short references (A3415102L, WI-206985) are shown; long ones (wiki paths) are left to the title. */
const shortRef = (ref: string) => (ref.length <= 24 ? ref : null);

export function SourceMark({ group, size = 18 }: { group: string; size?: number }) {
  return <span className={`src-mark sm-${group}`} aria-hidden="true"><Icon name={GROUP_ICON[group] ?? "file"} size={size} /></span>;
}

export function ResultTabs({ tab, setTab, counts }: { tab: ResultTab; setTab: (t: ResultTab) => void; counts: { evidence: number; related: number; followups: number } }) {
  const tabs: [ResultTab, string, number | null][] = [["answer", "Answer", null], ["evidence", "Evidence & Sources", counts.evidence], ["related", "Related Issues", counts.related], ["followups", "Follow-up Questions", counts.followups]];
  return (
    <div className="r-tabs" role="tablist" aria-label="Search results">
      {tabs.map(([v, label, n]) => (
        <button key={v} type="button" role="tab" id={`tab-${v}`} aria-selected={tab === v} aria-controls={`panel-${v}`} className={"r-tab " + (tab === v ? "active" : "")} onClick={() => setTab(v)}>
          {label}{n !== null && <span className="r-tab-n"> ({n})</span>}
        </button>
      ))}
    </div>
  );
}

/** Citation chips: open the cited record (permission-checked again by the record API). */
export function Cites({ ids, evidence }: { ids: string[]; evidence: RecordCard[] }) {
  const { openRecord } = useShell();
  if (!ids.length) return null;
  return (
    <span className="cites">{ids.map((id) => {
      const r = evidence.find((e) => e.evidenceId === id);
      if (!r) return null;
      return <button key={id} type="button" className={"cite cite-" + r.group} onClick={() => openRecord(r.id)} aria-label={`Open source ${r.ref}: ${r.title}`} title={`${r.ref} · ${r.title}`}>{shortRef(r.ref) ?? (r.title.length > 22 ? `${r.title.slice(0, 20)}…` : r.title)}</button>;
    })}</span>
  );
}

function StatusBadges({ a, cited }: { a: AnswerData; cited: number }) {
  const t = a.trust;
  return (
    <div className="ans-badges" aria-label="Evidence status">
      <Badge tone="info" icon="layers">{cited} supporting record{cited === 1 ? "" : "s"}</Badge>
      {t.rootCause === "confirmed" ? <Badge tone="good" icon="check">Root cause confirmed</Badge> : <Badge tone="warn" icon="alert">Root cause not confirmed</Badge>}
      {t.recovery === "temporary" && <Badge tone="warn" icon="refresh">Temporary recovery only</Badge>}
      {t.approved > 0 ? <Badge tone="good" icon="book">{t.approved} approved article{t.approved > 1 ? "s" : ""}</Badge> : <Badge tone="muted" icon="book">No approved knowledge</Badge>}
      {t.stale && <Badge tone="warn" icon="clock">Evidence over 18 months old</Badge>}
      <Badge tone="info" icon="lock">Permission-aware</Badge>
    </div>
  );
}

const EXPLAIN: Record<string, [string, string]> = { documented: ["Documented", "good"], pattern: ["Pattern across records", "info"], hypothesis: ["Hypothesis · not confirmed", "warn"] };

export function AnswerPanel({ a, evidence, onAsk, actions }: { a: AnswerData; evidence: RecordCard[]; onAsk: (q: string) => void; actions: React.ReactNode }) {
  const b = a.body;
  const citedIds = new Set([...b.summary, ...b.explanation, ...b.steps, ...b.hypotheses].flatMap((x) => x.citations));
  const cited = evidence.filter((e) => e.evidenceId && citedIds.has(e.evidenceId));
  const levels = ["low", "medium", "high"];
  const level = { low: "Limited", medium: "Moderate", high: "Strong" }[a.confidence.level];
  const troubleshooting = b.format === "troubleshooting";
  return (
    <article className="ans-panel" aria-labelledby="ans-title">
      <header className="ans-top">
        <span className="ans-mark" aria-hidden="true"><Icon name="sparkles" size={26} /></span>
        <div className="grow min0">
          <h2 id="ans-title">Answer from Synora</h2>
          <p className="muted small">
            Based on evidence from {a.trust.sourcesUsed} connected source{a.trust.sourcesUsed === 1 ? "" : "s"}
            {a.trust.lastEvidence ? <> · Newest evidence {fmtDate(a.trust.lastEvidence)}</> : null}
            {" · "}{a.provider === "openai" ? "Written by AI from the cited records" : "Composed from the evidence without AI"}
          </p>
        </div>
        <StatusBadges a={a} cited={cited.length} />
      </header>
      {a.note && <p className="ans-note"><Icon name="info" size={13} />{a.note}</p>}

      <div className="ans-summary-row">
        <section className="ans-block ans-summary" aria-labelledby="sum-h">
          <h3 id="sum-h"><Icon name="file" size={18} />{b.heading || "Summary"}</h3>
          <p className="summary">{b.summary.map((s, i) => <span key={i}>{s.text}<Cites ids={s.citations} evidence={evidence} /> </span>)}</p>
          {cited.length > 0 && <div className="src-chips" aria-label="Cited sources">{cited.map((r) => <CitedChip key={r.id} r={r} />)}</div>}
        </section>
        <aside className={"ans-conf c-" + a.confidence.level} aria-label="Evidence strength">
          <span className="eyebrow">Evidence strength <span title="Calculated from the cited records: how many there are, approved knowledge, confirmed root causes, temporary fixes and age. It is not a probability that the answer is correct." className="conf-i"><Icon name="info" size={13} /></span></span>
          <div className="conf-row"><span className="conf-ring" aria-hidden="true" data-level={levels.indexOf(a.confidence.level)} /><b>{level}</b></div>
          <p className="small muted">{a.confidence.why}</p>
          <p className="small muted">From {a.confidence.factors.join(", ")}.</p>
        </aside>
      </div>

      {b.clarification && <Callout tone="info" title="To narrow this down">{b.clarification} <button type="button" className="link-btn" onClick={() => onAsk(b.clarification!)}>Use as follow-up</button></Callout>}
      {b.warnings.filter((w) => w.kind === "temporary-fix" || w.kind === "discussion-only").map((w) => <Callout key={w.kind} tone="warn" title="Validate before applying">{w.text}</Callout>)}

      {b.explanation.length > 0 && (
        <section className="ans-block ans-explain" aria-labelledby="exp-h">
          <h3 id="exp-h"><Icon name="target" size={18} />{troubleshooting ? "Likely explanation" : "Details"}</h3>
          <ul className="explain-list">{b.explanation.map((x, i) => (
            <li key={i}><Badge tone={EXPLAIN[x.status]![1]}>{EXPLAIN[x.status]![0]}</Badge><span>{x.text}<Cites ids={x.citations} evidence={evidence} /></span></li>
          ))}</ul>
        </section>
      )}

      {b.hypotheses.length > 0 && (
        <section className="ans-block" aria-labelledby="hyp-h">
          <h3 id="hyp-h"><Icon name="activity" size={18} />Working hypotheses</h3>
          <ul className="explain-list">{b.hypotheses.map((h, i) => <li key={i}><Badge tone={h.status === "supported" ? "info" : h.status === "unlikely" ? "muted" : "warn"}>{h.status}</Badge><span>{h.text}<Cites ids={h.citations} evidence={evidence} /></span></li>)}</ul>
        </section>
      )}

      {b.steps.length > 0 && (
        <section className="ans-block" aria-labelledby="steps-h">
          <h3 id="steps-h"><Icon name="list" size={18} />{troubleshooting ? "Recommended investigation" : "Next steps"}</h3>
          <ol className="inv-steps">{b.steps.map((s, i) => (
            <li key={i}>
              <span className="inv-n" aria-hidden="true">{i + 1}</span>
              <div className="min0">
                <b>{s.title}</b> {s.basis === "recommended" && <Badge tone="muted">Recommendation · not from a source</Badge>}
                {s.detail && <p className="small">{s.detail}</p>}
                <Cites ids={s.citations} evidence={evidence} />
              </div>
            </li>
          ))}</ol>
        </section>
      )}

      {(b.unknowns.length > 0 || b.validation.length > 0) && (
        <div className="ans-gaps">
          {b.unknowns.length > 0 && <section className="ans-block ans-unknown" aria-labelledby="unk-h"><h3 id="unk-h"><Icon name="help" size={18} />What remains unknown</h3><ul>{b.unknowns.map((u) => <li key={u}>{u}</li>)}</ul></section>}
          {b.validation.length > 0 && <section className="ans-block ans-validate" aria-labelledby="val-h"><h3 id="val-h"><Icon name="check" size={18} />How to confirm a fix worked</h3><ul>{b.validation.map((u) => <li key={u}>{u}</li>)}</ul></section>}
        </div>
      )}
      {actions}
    </article>
  );
}

function CitedChip({ r }: { r: RecordCard }) {
  const { openRecord } = useShell();
  const label = shortRef(r.ref) ?? (r.title.length > 28 ? `${r.title.slice(0, 26)}…` : r.title);
  return <button type="button" className="src-chip" onClick={() => openRecord(r.id)} title={r.title}><SourceMark group={r.group} size={13} /><span>{GROUP_SHORT[r.group]} {label}</span></button>;
}

/** The right-hand panel: source filters over the real evidence, ranked cards, and what each source contributed. */
export function EvidencePanel({ evidence, totalMatches, sources, filter, setFilter, wide }: {
  evidence: RecordCard[]; totalMatches: number; sources: SourceCoverage[]; filter: string; setFilter: (g: string) => void; wide?: boolean;
}) {
  const groups = sources.filter((s) => s.state === "searched").map((s) => s.group);
  for (const e of evidence) if (!groups.includes(e.group)) groups.push(e.group);
  const list = evidence.filter((e) => filter === "all" || e.group === filter);
  const top = evidence[0]?.id;
  return (
    <section className={"ev-panel " + (wide ? "wide" : "")} aria-labelledby="ev-h">
      <header className="ev-head">
        <h2 id="ev-h"><Icon name="layers" size={18} />Evidence across connected sources</h2>
        <span className="muted small">{evidence.length} record{evidence.length === 1 ? "" : "s"}{totalMatches > evidence.length ? ` · ${totalMatches} matches in total` : ""}</span>
      </header>
      <div className="ev-filters" role="group" aria-label="Filter evidence by source">
        <button type="button" className={"ev-filter " + (filter === "all" ? "on" : "")} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All sources ({evidence.length})</button>
        {groups.map((g) => {
          const n = evidence.filter((e) => e.group === g).length;
          return <button key={g} type="button" className={"ev-filter " + (filter === g ? "on" : "")} aria-pressed={filter === g} onClick={() => setFilter(g)}><SourceMark group={g} size={12} />{GROUP_SHORT[g]} ({n})</button>;
        })}
      </div>
      {list.length ? <ol className="ev-list">{list.map((r) => <EvidenceItem key={r.id} r={r} top={r.id === top} />)}</ol>
        : <Empty icon="search" title={`No ${GROUP_SHORT[filter] ?? ""} evidence for this question`}>That source was searched, but none of its records you can access supports this answer.</Empty>}
      <SourceCoverageList sources={sources} />
    </section>
  );
}

function EvidenceItem({ r, top }: { r: RecordCard; top: boolean }) {
  const { openRecord } = useShell();
  const [open, setOpen] = useState(false);
  const [rel, relTone] = RELEVANCE[r.relevance] ?? ["Related", "neutral"];
  return (
    <li className="ev-item">
      <SourceMark group={r.group} />
      <div className="ev-body min0">
        <div className="ev-line">
          <span className="ev-src"><b>{r.demo ? "Demonstration data" : r.sourceSystem}</b> · {r.category && r.group !== "demo" ? r.category : typeText(r.recordType)}</span>
          <span className="muted small">{fmtDate(r.updatedAt)}</span>
          {top ? <Badge tone="good" icon="check">Most relevant</Badge> : <Badge tone={relTone}>{rel}</Badge>}
        </div>
        <button type="button" className="ev-title2" onClick={() => openRecord(r.id)}>{shortRef(r.ref) && <span className="mono">{r.ref} </span>}{shortRef(r.ref) && r.title.startsWith(r.ref) ? r.title.slice(r.ref.length).replace(/^\s*[-:–]\s*/, "") : r.title}</button>
        <p className={"ev-excerpt " + (open ? "open" : "")}>{r.excerpt || r.resolution || "No excerpt available."}</p>
        {open && (
          <dl className="ev-dl">
            {r.analysis && <><dt>Analysis</dt><dd className="ev-pre">{r.analysis}</dd></>}
            {r.rootCause && <><dt>Root cause</dt><dd>{r.rootCause}</dd></>}
            {r.resolution && <><dt>{r.evidenceKind === "approved" ? "Covers" : "Resolution"}</dt><dd>{r.resolution}</dd></>}
            {r.status && <><dt>Status</dt><dd><StatusPill status={r.status} /></dd></>}
            <dt>Evidence type</dt><dd><KindBadge kind={r.evidenceKind} /></dd>
            <dt>Space</dt><dd>{r.space}</dd>
            {r.links.length > 0 && <><dt>Linked</dt><dd className="mono small">{r.links.slice(0, 6).join(", ")}</dd></>}
            <dt>Relevance</dt><dd>{rel} (semantic similarity {(r.similarity / 100).toFixed(2)}; this is retrieval relevance, not answer correctness)</dd>
          </dl>
        )}
        <div className="ev-actions2">
          {r.sourceUrl && !r.demo
            ? <a className="link-btn" href={r.sourceUrl} target="_blank" rel="noreferrer">{OPEN_IN[r.group] ?? "Open original"} <Icon name="external" size={13} /></a>
            : <button type="button" className="link-btn" onClick={() => openRecord(r.id)}>Open record <Icon name="right" size={13} /></button>}
          <Badge tone={ROLE_TONE[r.role] ?? "neutral"}>{r.roleLabel}</Badge>
          {r.demo && <Badge tone="violet" icon="info">Demonstration record</Badge>}
          {r.analysis && <Badge tone="info" icon="activity">Has analysis</Badge>}
          <button type="button" className="link-btn ev-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Less" : "More"}</button>
        </div>
      </div>
    </li>
  );
}

/** Which sources this search covered. A source that isn't connected or hasn't synced is said so, never implied. */
export function SourceCoverageList({ sources }: { sources: SourceCoverage[] }) {
  if (!sources.length) return null;
  const text = { searched: "searched", "not-synced": "no records synced yet, not searched", unavailable: "not set up, not searched" };
  return (
    <div className="ev-coverage" aria-label="Sources covered by this search">
      <span className="eyebrow">Sources covered</span>
      <ul>{sources.map((s) => (
        <li key={s.group}><span className={"health-dot " + (s.state === "searched" ? "hd-good" : "hd-warn")} aria-hidden="true" /><span><b>{s.label}</b> {text[s.state]}{s.state === "searched" ? ` · ${s.indexed.toLocaleString("en-GB")} records you can access · ${s.evidence} used here` : ""}</span></li>
      ))}</ul>
    </div>
  );
}

export function RelatedPanel({ related }: { related: RelatedIssue[] }) {
  const { openRecord } = useShell();
  if (!related.length) return <Empty icon="link" title="No related issues">No other records you can access are linked to this evidence or match the question closely.</Empty>;
  return (
    <section className="rel-panel" aria-label="Related issues">
      <p className="muted small">Records linked to the evidence (parent, duplicate or mentioned) and further matches that weren&apos;t needed for the answer.</p>
      <ul className="rel-list">{related.map((r) => (
        <li key={r.id}>
          <SourceMark group={r.group} />
          <button type="button" className="rec-main" onClick={() => openRecord(r.id)}>
            <span className="rec-title">{shortRef(r.ref) && <span className="mono">{r.ref} </span>}{r.title}</span>
            <span className="muted small">{r.demo ? "Demonstration data" : r.sourceSystem} · {fmtDate(r.updatedAt)} · {r.why}</span>
          </button>
          {r.status && <StatusPill status={r.status} />}
        </li>
      ))}</ul>
    </section>
  );
}

export function FollowUpPanel({ followUps, clarification, onAsk }: { followUps: string[]; clarification: string | null; onAsk: (q: string) => void }) {
  const all = [...(clarification ? [clarification] : []), ...followUps];
  if (!all.length) return <Empty icon="chat" title="No follow-up questions">Ask your own follow-up in the box below.</Empty>;
  return (
    <section aria-label="Follow-up questions">
      <ul className="fu-list">{all.map((q) => <li key={q}><button type="button" className="fu-item" onClick={() => onAsk(q)}><Icon name="sparkles" size={16} /><span>{q}</span><Icon name="arrow" size={16} /></button></li>)}</ul>
      <p className="muted small">Suggested from this answer{followUps.length ? "" : " and its gaps"}. Choosing one runs a new search.</p>
    </section>
  );
}

export function ActionBar({ children }: { children: React.ReactNode }) {
  return <div className="answer-actions" role="toolbar" aria-label="Answer actions">{children}</div>;
}

export { Btn };
