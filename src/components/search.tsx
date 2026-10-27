"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnswerBody, Confidence } from "@/lib/search/answer";
import type { RecordCard, SearchEvent, Trust } from "@/lib/search/pipeline";
import { fmtDate, typeText, useShell } from "./shell";
import { Badge, Btn, Callout, copyText, Drawer, Empty, Icon, IconBtn, KindBadge, Logo, Modal, Popover, Similarity, SourceIcon, StatusPill } from "./ui";

type Mode = "ask" | "records" | "similar" | "investigate";

const MODES: { value: Mode; label: string; icon: string; ph: string }[] = [
  { value: "ask", label: "Ask Synora", icon: "sparkles", ph: "Describe an issue or ask a question about connected enterprise knowledge…" },
  { value: "records", label: "Search Records", icon: "list", ph: "Search tickets, documents, emails and work items by keyword or reference…" },
  { value: "similar", label: "Find Similar Issues", icon: "similar", ph: "Paste the incident description to find similar historical issues…" },
  { value: "investigate", label: "Investigate Incident", icon: "target", ph: "Describe the incident: symptoms, timing, environment and error messages…" },
];

interface Filters { spaces: string[]; sourceSystems: string[]; recordTypes: string[]; evidenceKinds: string[]; updatedWithinDays: number | null }
const NO_FILTERS: Filters = { spaces: [], sourceSystems: [], recordTypes: [], evidenceKinds: [], updatedWithinDays: null };

interface TurnState {
  id: number; q: string; mode: Mode;
  stage: string | null; evidence: RecordCard[]; totalRelated: number;
  answer: { body: AnswerBody; confidence: Confidence; provider: string; note: string | null; trust: Trust } | null;
  insufficient: { reason: string; records: RecordCard[] } | null;
  records: RecordCard[] | null; similar: (RecordCard & { why: string[] })[] | null;
  error: string | null; done: { searchId: string; answerId: string | null; latencyMs: number } | null;
}

let seq = 0;

export function SearchClient(props: {
  initialQuery: string; initialMode: string; autoRun: boolean; suggestions: string[];
  recent: { q: string; when: string }[]; spaces: { id: string; name: string }[]; sourceSystems: { name: string; count: number }[];
}) {
  const { user } = useShell();
  const [query, setQuery] = useState(props.initialQuery || props.suggestions[0] || "");
  const [mode, setMode] = useState<Mode>((MODES.some((m) => m.value === props.initialMode) ? props.initialMode : "ask") as Mode);
  const [turns, setTurns] = useState<TurnState[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [history, setHistory] = useState(props.recent);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  const update = (id: number, patch: Partial<TurnState> | ((t: TurnState) => Partial<TurnState>)) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)));

  const submit = async (text = query, m: Mode = mode) => {
    const q = text.trim();
    if (q.length < 2) { inputRef.current?.focus(); return; }
    const id = ++seq;
    setTurns((t) => t.concat({ id, q, mode: m, stage: "understanding", evidence: [], totalRelated: 0, answer: null, insufficient: null, records: null, similar: null, error: null, done: null }));
    setHistory((h) => [{ q, when: new Date().toISOString() }, ...h.filter((x) => x.q !== q)].slice(0, 8));
    setQuery("");
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q, mode: m, filters: compact(filters) }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        update(id, { error: (j as { error?: string }).error ?? "Search service unavailable. Try again in a minute.", stage: null });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as SearchEvent;
          if (ev.type === "stage") update(id, { stage: ev.stage });
          else if (ev.type === "evidence") update(id, { evidence: ev.records, totalRelated: ev.totalRelated });
          else if (ev.type === "answer") update(id, { answer: { body: ev.body, confidence: ev.confidence, provider: ev.provider, note: ev.note, trust: ev.trust }, stage: null });
          else if (ev.type === "insufficient") update(id, { insufficient: { reason: ev.reason, records: ev.records }, stage: null });
          else if (ev.type === "records") update(id, { records: ev.records, stage: null });
          else if (ev.type === "similar") update(id, { similar: ev.records, stage: null });
          else if (ev.type === "error") update(id, { error: ev.message, stage: null });
          else if (ev.type === "done") update(id, { done: ev, stage: null });
        }
      }
    } catch {
      update(id, { error: "Search service unavailable. Your question was not lost; try again in a minute.", stage: null });
    }
  };

  useEffect(() => { if (props.autoRun && props.initialQuery && !ran.current) { ran.current = true; void submit(props.initialQuery, mode); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (turns.length) endRef.current?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [turns.length]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "/" && !/input|textarea|select/i.test((document.activeElement as HTMLElement)?.tagName ?? "")) { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const refine = (q: string) => { setQuery(q); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(q.length, q.length); }, 0); };
  const box = <SearchBox inputRef={inputRef} query={query} setQuery={setQuery} mode={mode} setMode={setMode} onSubmit={() => submit()} compact={turns.length > 0}
    filters={filters} setFilters={setFilters} spaces={props.spaces} sourceSystems={props.sourceSystems} history={history} canInvestigate={user.can.investigate} />;

  if (!turns.length) {
    return (
      <div className="search-landing">
        <div className="landing-hero">
          <Logo size={52} />
          <h1>How can Synora help?</h1>
          <p className="muted">Search connected enterprise knowledge across tickets, documents, email and work items.</p>
        </div>
        {box}
        {props.suggestions.length > 0 && (
          <section className="landing-section" aria-labelledby="sugg-h">
            <h2 id="sugg-h" className="eyebrow">Suggested for your spaces</h2>
            <div className="prompt-grid">
              {props.suggestions.map((p) => <button key={p} type="button" className="prompt-card" onClick={() => submit(p, mode)}><Icon name="sparkles" size={16} /><span>{p}</span></button>)}
            </div>
          </section>
        )}
        <div className="landing-cols">
          <section className="landing-section" aria-labelledby="recent-h">
            <h2 id="recent-h" className="eyebrow">Your recent searches</h2>
            {history.length ? (
              <ul className="recent-list">{history.slice(0, 5).map((h) => (
                <li key={h.q}><button type="button" className="recent-item" onClick={() => submit(h.q, mode)}><Icon name="history" size={16} /><span className="recent-text"><b>{h.q}</b><span className="muted small">{fmtDate(h.when)}</span></span><Icon name="right" size={16} /></button></li>
              ))}</ul>
            ) : <p className="muted small">Searches you run appear here.</p>}
          </section>
          <section className="landing-section" aria-labelledby="avail-h">
            <h2 id="avail-h" className="eyebrow">What you can search</h2>
            {props.spaces.length ? (
              <ul className="avail-list">
                {props.spaces.map((s) => <li key={s.id}><span className="health-dot hd-good" aria-hidden="true" /><span className="avail-name">{s.name}</span><span className="muted small">space</span></li>)}
                {props.sourceSystems.map((s) => <li key={s.name}><SourceIcon source={s.name} size={13} /><span className="avail-name">{s.name}</span><span className="muted small num">{s.count}</span></li>)}
              </ul>
            ) : <Callout tone="info">You aren&apos;t a member of any space yet, so there is nothing to search. Ask an administrator for access.</Callout>}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="search-thread">
      <div className="thread-bar"><Btn icon="plus" size="sm" onClick={() => { setTurns([]); setQuery(""); setTimeout(() => inputRef.current?.focus(), 0); }}>New search</Btn></div>
      <div className="thread">
        {turns.map((t, i) => (
          <div key={t.id} ref={i === turns.length - 1 ? endRef : null} className="turn">
            <div className="q-bubble">
              <Badge tone="neutral" icon={MODES.find((m) => m.value === t.mode)!.icon}>{MODES.find((m) => m.value === t.mode)!.label}</Badge>
              <p>{t.q}</p>
            </div>
            <TurnView t={t} onRefine={refine} onMode={(m) => submit(t.q, m)} canInvestigate={user.can.investigate} />
          </div>
        ))}
      </div>
      <div className="dock">{box}</div>
    </div>
  );
}

function compact(f: Filters) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : v != null)));
}

function SearchBox({ inputRef, query, setQuery, mode, setMode, onSubmit, compact: isCompact, filters, setFilters, spaces, sourceSystems, history, canInvestigate }: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>; query: string; setQuery: (q: string) => void; mode: Mode; setMode: (m: Mode) => void; onSubmit: () => void; compact: boolean;
  filters: Filters; setFilters: (f: Filters) => void; spaces: { id: string; name: string }[]; sourceSystems: { name: string; count: number }[]; history: { q: string; when: string }[]; canInvestigate: boolean;
}) {
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const modes = MODES.filter((m) => m.value !== "investigate" || canInvestigate);

  useEffect(() => {
    const fit = () => { const el = inputRef.current; if (!el || !el.offsetWidth) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 220) + "px"; };
    const id = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", fit); };
  }, [query, inputRef]);

  const spaceLabel = !filters.spaces.length ? "All my spaces" : filters.spaces.length === 1 ? spaces.find((s) => s.id === filters.spaces[0])?.name ?? "1 space" : `${filters.spaces.length} spaces`;
  const nFilters = filters.sourceSystems.length + filters.recordTypes.length + filters.evidenceKinds.length + (filters.updatedWithinDays ? 1 : 0);
  const chips = [
    ...filters.sourceSystems.map((v) => ({ label: v, clear: () => setFilters({ ...filters, sourceSystems: filters.sourceSystems.filter((x) => x !== v) }) })),
    ...filters.recordTypes.map((v) => ({ label: typeText(v), clear: () => setFilters({ ...filters, recordTypes: filters.recordTypes.filter((x) => x !== v) }) })),
    ...filters.evidenceKinds.map((v) => ({ label: EVIDENCE_LABEL[v] ?? v, clear: () => setFilters({ ...filters, evidenceKinds: filters.evidenceKinds.filter((x) => x !== v) }) })),
    ...(filters.updatedWithinDays ? [{ label: `Updated in the last ${filters.updatedWithinDays} days`, clear: () => setFilters({ ...filters, updatedWithinDays: null }) }] : []),
    ...filters.spaces.map((v) => ({ label: spaces.find((s) => s.id === v)?.name ?? v, clear: () => setFilters({ ...filters, spaces: filters.spaces.filter((x) => x !== v) }) })),
  ];
  return (
    <div className={"searchbox-wrap " + (isCompact ? "compact" : "")}>
      <div className="mode-row" role="radiogroup" aria-label="Search mode">
        {modes.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} className={"mode-pill " + (mode === m.value ? "active" : "")} onClick={() => { setMode(m.value); inputRef.current?.focus(); }}>
            <Icon name={m.icon} size={15} />{m.label}
          </button>
        ))}
      </div>
      <form className="searchbox" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <label htmlFor="main-search" className="sr-only">Search query</label>
        <textarea id="main-search" ref={inputRef} rows={isCompact ? 1 : 2} value={query} placeholder={MODES.find((m) => m.value === mode)!.ph}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }} />
        <div className="searchbox-tools">
          <div className="tools-left">
            <IconBtn icon="paperclip" label="Paste incident details" onClick={() => setAttachOpen(true)} />
            <div className="rel">
              <button type="button" className="tool-btn" aria-expanded={spaceOpen} onClick={() => setSpaceOpen(!spaceOpen)}><Icon name="layers" size={16} /><span className="tool-label">{spaceLabel}</span><Icon name="chevDown" size={14} /></button>
              <Popover open={spaceOpen} onClose={() => setSpaceOpen(false)} align="left" className="src-pop">
                <div className="pop-head"><h3 className="pop-title">Search in</h3>{filters.spaces.length > 0 && <button type="button" className="link-btn" onClick={() => setFilters({ ...filters, spaces: [] })}>All my spaces</button>}</div>
                <ul className="check-list">{spaces.map((s) => (
                  <li key={s.id}><label className="check"><input type="checkbox" checked={filters.spaces.includes(s.id)} onChange={() => setFilters({ ...filters, spaces: filters.spaces.includes(s.id) ? filters.spaces.filter((x) => x !== s.id) : filters.spaces.concat(s.id) })} /><span className="grow">{s.name}</span></label></li>
                ))}</ul>
                <p className="hint">Results only include records you are authorized to see.</p>
              </Popover>
            </div>
            <button type="button" className="tool-btn" onClick={() => setFiltersOpen(true)}><Icon name="filter" size={16} /><span className="tool-label">Filters</span>{nFilters ? <span className="count-pill">{nFilters}</span> : null}</button>
            <div className="rel">
              <IconBtn icon="history" label="Search history" aria-expanded={histOpen} onClick={() => setHistOpen(!histOpen)} />
              <Popover open={histOpen} onClose={() => setHistOpen(false)} align="left" className="hist-pop">
                <h3 className="pop-title">Recent searches</h3>
                {history.length ? <ul className="hist-list">{history.map((h) => <li key={h.q}><button type="button" onClick={() => { setQuery(h.q); setHistOpen(false); inputRef.current?.focus(); }}><Icon name="history" size={14} /><span>{h.q}</span><span className="muted small">{fmtDate(h.when)}</span></button></li>)}</ul> : <p className="muted small">No searches yet.</p>}
              </Popover>
            </div>
          </div>
          <div className="tools-right">
            {query && <IconBtn icon="x" label="Clear query" onClick={() => { setQuery(""); inputRef.current?.focus(); }} />}
            <button type="submit" className="send-btn" aria-label="Submit search" disabled={query.trim().length < 2}><Icon name="arrow" size={18} /></button>
          </div>
        </div>
      </form>
      {chips.length > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {chips.map((c) => <span key={c.label} className="fchip">{c.label}<button type="button" aria-label={`Remove filter ${c.label}`} onClick={c.clear}><Icon name="x" size={13} /></button></span>)}
          <button type="button" className="link-btn" onClick={() => setFilters(NO_FILTERS)}>Reset all</button>
        </div>
      )}
      {filtersOpen && <FilterDrawer filters={filters} setFilters={setFilters} sourceSystems={sourceSystems} onClose={() => setFiltersOpen(false)} />}
      {attachOpen && (
        <PasteModal onClose={() => setAttachOpen(false)} onPaste={(text) => { setQuery((query ? query + "\n" : "") + text); setAttachOpen(false); setTimeout(() => inputRef.current?.focus(), 0); }} />
      )}
    </div>
  );
}

const EVIDENCE_LABEL: Record<string, string> = { approved: "Approved knowledge", historical: "Historical records", discussion: "Discussions", dev_work: "Development work" };
const RECORD_TYPES = ["incident", "request", "bug", "work_item", "document", "knowledge_article", "email", "chat"];

function FilterDrawer({ filters, setFilters, sourceSystems, onClose }: { filters: Filters; setFilters: (f: Filters) => void; sourceSystems: { name: string; count: number }[]; onClose: () => void }) {
  const [d, setD] = useState(filters);
  const toggle = (k: "sourceSystems" | "recordTypes" | "evidenceKinds", v: string) => setD({ ...d, [k]: d[k].includes(v) ? d[k].filter((x) => x !== v) : d[k].concat(v) });
  const facet = (k: "sourceSystems" | "recordTypes" | "evidenceKinds", label: string, opts: { v: string; l: string }[]) => (
    <div className="facet"><span className="label">{label}</span>
      <div className="chip-row">{opts.map((o) => <button key={o.v} type="button" className={"chip " + (d[k].includes(o.v) ? "chip-on" : "")} aria-pressed={d[k].includes(o.v)} onClick={() => toggle(k, o.v)}>{d[k].includes(o.v) && <Icon name="check" size={13} />}{o.l}</button>)}</div>
    </div>
  );
  return (
    <Drawer title="Filters" onClose={onClose} footer={<><Btn variant="ghost" onClick={() => setD(NO_FILTERS)}>Reset</Btn><Btn variant="primary" onClick={() => { setFilters({ ...d, spaces: filters.spaces }); onClose(); }}>Apply</Btn></>}>
      <div className="facet"><label className="label" htmlFor="f-date">Last updated</label>
        <select id="f-date" className="input" value={d.updatedWithinDays ?? ""} onChange={(e) => setD({ ...d, updatedWithinDays: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Any time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
        </select></div>
      {facet("sourceSystems", "Source", sourceSystems.map((s) => ({ v: s.name, l: `${s.name} (${s.count})` })))}
      {facet("recordTypes", "Record type", RECORD_TYPES.map((t) => ({ v: t, l: typeText(t) })))}
      {facet("evidenceKinds", "Evidence", Object.entries(EVIDENCE_LABEL).map(([v, l]) => ({ v, l })))}
    </Drawer>
  );
}

function PasteModal({ onClose, onPaste }: { onClose: () => void; onPaste: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Modal title="Paste incident details" subtitle="Ticket text, timestamps and error messages help Synora find similar cases." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!text.trim()} onClick={() => onPaste(text.trim())}>Add to search</Btn></>}>
      <label htmlFor="paste-text" className="label">Incident details</label>
      <textarea id="paste-text" className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste symptoms, timestamps, error messages…" />
    </Modal>
  );
}

const STAGES = [["understanding", "Understanding the question"], ["searching", "Searching the spaces you can access"], ["ranking", "Ranking evidence by relevance"], ["writing", "Writing a source-backed answer"]] as const;

function TurnView({ t, onRefine, onMode, canInvestigate }: { t: TurnState; onRefine: (q: string) => void; onMode: (m: Mode) => void; canInvestigate: boolean }) {
  const { openRecord } = useShell();
  if (t.error && !t.evidence.length) return <div className="answer"><Callout tone="bad" title="Search service unavailable" action={<Btn size="sm" icon="refresh" onClick={() => onMode(t.mode)}>Retry</Btn>}>{t.error}</Callout></div>;
  if (t.insufficient) return <Insufficient t={t} onRefine={onRefine} />;
  if (t.records) return <RecordsView records={t.records} q={t.q} />;
  if (t.similar) {
    return (
      <div className="answer">
        <div className="answer-head"><span className="ai-mark"><Icon name="similar" size={16} /></span><b>{t.similar.length} similar issue{t.similar.length === 1 ? "" : "s"}</b><span className="muted small">Ranked by similarity</span></div>
        {!t.similar.length && <Empty icon="similar" title="No similar issues found">Add error messages or the application name to the description.</Empty>}
        <div className="sim-inline">{t.similar.map((r) => (
          <div key={r.id} className="sim-row">
            <Similarity value={r.similarity} />
            <button type="button" className="rec-main" onClick={() => openRecord(r.id)}>
              <span className="rec-title">{r.title}</span>
              <span className="muted small"><span className="mono">{r.ref}</span> · {r.sourceSystem} · {r.application ?? r.space} · {fmtDate(r.updatedAt)}</span>
              <span className="small"><b>Root cause:</b> {r.rootCause || "Not documented"}</span>
              {r.why.length > 0 && <span className="small muted">Why similar: {r.why.join(" · ")}</span>}
            </button>
            {r.status && <StatusPill status={r.status} />}
          </div>
        ))}</div>
        <Callout tone="info">Never apply a previous resolution without validating it against the current issue.</Callout>
      </div>
    );
  }
  if (!t.answer) {
    const idx = STAGES.findIndex(([k]) => k === t.stage);
    return (
      <div className="answer" aria-busy="true">
        <div className="answer-head"><span className="ai-mark"><Icon name="sparkles" size={16} /></span><b>Synora</b><span className="muted small">{t.evidence.length ? "Writing answer…" : "Searching…"}</span></div>
        <ol className="retrieve" aria-live="polite">{STAGES.map(([k, label], i) => <li key={k} className={i < idx ? "done" : i === idx ? "now" : ""}><span className="r-dot">{i < idx ? <Icon name="check" size={12} /> : null}</span>{label}</li>)}</ol>
        {t.evidence.length > 0 && <div className="answer-side">{t.evidence.slice(0, 3).map((r) => <EvidenceCard key={r.id} r={r} compact />)}</div>}
        {t.error && <Callout tone="warn">{t.error}</Callout>}
      </div>
    );
  }
  return <AnswerView t={t} onRefine={onRefine} onMode={onMode} canInvestigate={canInvestigate} />;
}

function Cite({ ids, evidence }: { ids: string[]; evidence: RecordCard[] }) {
  const { openRecord } = useShell();
  if (!ids.length) return null;
  return (
    <span className="cites">{ids.map((id) => {
      const r = evidence.find((e) => e.evidenceId === id);
      if (!r) return null;
      return <button key={id} type="button" className={"cite k-" + ({ discussion: "email", dev_work: "devwork" }[r.evidenceKind] ?? r.evidenceKind)} onClick={() => openRecord(r.id)} aria-label={`Open source ${r.ref}: ${r.title}`} title={`${r.ref} · ${EVIDENCE_LABEL[r.evidenceKind] ?? r.evidenceKind}`}>{r.ref}</button>;
    })}</span>
  );
}

function AnswerView({ t, onRefine, onMode, canInvestigate }: { t: TurnState; onRefine: (q: string) => void; onMode: (m: Mode) => void; canInvestigate: boolean }) {
  const { toast } = useShell();
  const router = useRouter();
  const a = t.answer!;
  const ev = t.evidence;
  const investigate = t.mode === "investigate";
  const [feedback, setFeedback] = useState<null | "up" | "down">(null);
  const [askWhy, setAskWhy] = useState(false);
  const [modal, setModal] = useState<null | "summary">(null);
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const plain = useMemo(() => [
    `Synora answer`, ``, `Question: ${t.q}`, ``, `Summary`, a.body.summary.map((s) => s.text).join(" "), ``,
    investigate ? "Investigation checklist" : "Recommended next steps", ...a.body.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` ${s.detail}` : ""}`), ``,
    `Confidence: ${a.confidence.level}. ${a.confidence.why}`, ...a.body.warnings.map((w) => `Important: ${w.text}`), ``,
    `Sources: ${ev.map((e) => `${e.ref} (${e.sourceSystem})`).join(", ")}`,
  ].join("\n"), [a, ev, t.q, investigate]);

  const sendFeedback = async (helpful: boolean, reason?: string) => {
    if (!t.done?.answerId) return;
    const res = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answerId: t.done.answerId, helpful, reason }) });
    toast(res.ok ? (helpful ? "Thanks. Marked as helpful." : "Thanks. Your feedback helps improve answers.") : "Feedback couldn't be sent.", res.ok ? "good" : "bad");
  };
  const save = async () => {
    const res = await fetch("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "answer", name: t.q.slice(0, 120), query: t.q, mode: t.mode, answerId: t.done?.answerId }) });
    toast(res.ok ? "Saved. Find it under Saved." : "Couldn't save this answer.", res.ok ? "good" : "bad");
  };
  const investigation = async () => {
    const res = await fetch("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "answer", name: t.q.slice(0, 120), query: t.q, mode: "investigate", answerId: t.done?.answerId, tags: ["investigation"], collectionName: `Investigation: ${t.q.slice(0, 60)}` }) });
    if (!res.ok) { toast("Couldn't create the investigation.", "bad"); return; }
    await Promise.all(ev.map((r) => fetch("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "record", name: `${r.ref} – ${r.title.slice(0, 60)}`, recordId: r.id }) })));
    toast("Investigation created under Saved → Collections.");
  };
  const tone = { high: "good", medium: "warn", low: "bad" }[a.confidence.level];
  const levels = ["low", "medium", "high"];

  return (
    <article className="answer">
      <div className="answer-head">
        <span className="ai-mark"><Icon name="sparkles" size={16} /></span><b>Synora</b>
        <span className="muted small">Synora found related evidence{t.done ? ` · ${(t.done.latencyMs / 1000).toFixed(1)} s` : ""}</span>
      </div>
      <ul className="trust" aria-label="Answer trust indicators">
        <li><Icon name="check" size={14} />Source-backed</li>
        <li><Icon name="layers" size={14} />{a.trust.supporting} supporting · {a.trust.related} related</li>
        {a.trust.lastEvidence && <li><Icon name="clock" size={14} />Evidence updated {fmtDate(a.trust.lastEvidence)}</li>}
        <li className={a.trust.approved ? "t-good" : "t-warn"}><Icon name={a.trust.approved ? "book" : "alert"} size={14} />{a.trust.approved ? `${a.trust.approved} approved article${a.trust.approved > 1 ? "s" : ""}` : "No approved knowledge"}</li>
        <li><Icon name="lock" size={14} />Permission-aware</li>
        {a.trust.conflicting && <li className="t-warn"><Icon name="alert" size={14} />Past fixes were temporary</li>}
        {a.trust.stale && <li className="t-warn"><Icon name="clock" size={14} />Evidence is over 18 months old</li>}
      </ul>
      {a.note && <p className="ans-note"><Icon name="info" size={13} />{a.note}</p>}

      <div className="answer-grid">
        <div className="answer-main">
          <section className="ans-sec">
            <h3>{investigate ? "Incident summary" : "Issue summary"} {a.provider === "openai" ? <KindBadge kind="ai" /> : <Badge tone="neutral" icon="list">Extracted from evidence, no AI</Badge>}</h3>
            <p className="summary">{a.body.summary.map((s, i) => <span key={i}>{s.text}<Cite ids={s.citations} evidence={ev} /> </span>)}</p>
          </section>
          {a.body.warnings.filter((w) => w.kind !== "historical").map((w) => <Callout key={w.kind} tone="warn" title="Validate before applying">{w.text}</Callout>)}
          {investigate && a.body.hypotheses.length > 0 && (
            <section className="ans-sec"><h3>Working hypotheses</h3>
              <ul className="hypo-list">{a.body.hypotheses.map((h) => <li key={h.text}><div><b>{h.text}</b><span className="muted small">{h.status}</span></div><Cite ids={h.citations} evidence={ev} /></li>)}</ul>
            </section>
          )}
          {a.body.steps.length > 0 && (
            <section className="ans-sec">
              <h3>{investigate ? "Investigation checklist" : "Recommended next steps"}</h3>
              <ol className="steps">{a.body.steps.map((s, i) => (
                <li key={i}>
                  {investigate
                    ? <label className="step-check"><input type="checkbox" checked={!!checks[i]} onChange={() => setChecks({ ...checks, [i]: !checks[i] })} /><span><b>{s.title}</b>{s.detail && <span className="muted"> {s.detail}</span>}</span></label>
                    : <span><b>{s.title}</b>{s.detail && <span className="muted"> {s.detail}</span>}</span>}
                  <Cite ids={s.citations} evidence={ev} />
                </li>
              ))}</ol>
              {investigate && <p className="muted small">{Object.values(checks).filter(Boolean).length} of {a.body.steps.length} checks completed</p>}
            </section>
          )}
        </div>
        <aside className="answer-side" aria-label="Supporting evidence">
          <div className="side-head"><h3>Evidence</h3><span className="muted small">{ev.length} record{ev.length === 1 ? "" : "s"}</span></div>
          {ev.map((r) => <EvidenceCard key={r.id} r={r} />)}
        </aside>
      </div>

      <section className={"confidence c-" + tone}>
        <div className="conf-gauge" aria-hidden="true">{levels.map((l) => <span key={l} className={"seg " + (levels.indexOf(l) <= levels.indexOf(a.confidence.level) ? "on" : "")} />)}</div>
        <div><b>{a.confidence.level[0]!.toUpperCase() + a.confidence.level.slice(1)} confidence</b><p>{a.confidence.why}</p><p className="muted small">Based on {a.confidence.factors.join(", ")}.</p></div>
      </section>

      <div className="answer-actions" role="toolbar" aria-label="Answer actions">
        <IconBtn icon="copy" label="Copy answer" onClick={async () => toast((await copyText(plain)) ? "Answer copied" : "Copy is blocked here. Select the text to copy it.", "info")} />
        <IconBtn icon="bookmark" label="Save answer" onClick={save} />
        <IconBtn icon="up" label="Mark helpful" className={feedback === "up" ? "pressed" : ""} aria-pressed={feedback === "up"} onClick={() => { setFeedback("up"); setAskWhy(false); void sendFeedback(true); }} />
        <IconBtn icon="down" label="Mark not helpful" className={feedback === "down" ? "pressed" : ""} aria-pressed={feedback === "down"} onClick={() => { setFeedback("down"); setAskWhy(true); }} />
        <IconBtn icon="share" label="Copy a link to this search" onClick={async () => toast((await copyText(`${location.origin}/?q=${encodeURIComponent(t.q)}&mode=${t.mode}&run=1`)) ? "Link copied. People who open it see only what they're allowed to." : "Copy is blocked here.", "info")} />
        <IconBtn icon="download" label="Copy as Markdown" onClick={async () => toast((await copyText(plain.replace(/^(Summary|Recommended next steps|Investigation checklist)$/gm, "## $1"))) ? "Copied as Markdown" : "Copy is blocked here.", "info")} />
        <span className="act-sep" />
        <Btn size="sm" icon="edit" onClick={() => onRefine(t.q)}>Refine search</Btn>
        {!investigate && canInvestigate && <Btn size="sm" icon="target" onClick={() => onMode("investigate")}>Investigate</Btn>}
        <Btn size="sm" icon="similar" onClick={() => router.push(`/similar?q=${encodeURIComponent(t.q)}`)}>Similar issues</Btn>
        <Btn size="sm" icon="folder" onClick={investigation}>Create investigation</Btn>
        <Btn size="sm" icon="file" onClick={() => setModal("summary")}>Incident summary</Btn>
      </div>
      {askWhy && <NotHelpful onDone={(reason) => { setAskWhy(false); void sendFeedback(false, reason); }} onCancel={() => setAskWhy(false)} />}
      {modal === "summary" && (
        <Modal title="Incident summary" subtitle="Draft built from this answer. Review before adding to a ticket." onClose={() => setModal(null)} size="lg"
          footer={<><Btn variant="ghost" onClick={() => setModal(null)}>Close</Btn><Btn variant="primary" icon="copy" onClick={async () => toast((await copyText(summaryText(t, a))) ? "Summary copied. Paste it into the ticket's work notes." : "Select the text to copy it.")}>Copy</Btn></>}>
          <KindBadge kind="ai" />
          <pre className="summary-pre">{summaryText(t, a)}</pre>
        </Modal>
      )}
    </article>
  );
}

function summaryText(t: TurnState, a: NonNullable<TurnState["answer"]>) {
  return [
    `Reported issue: ${t.q}`,
    `Pattern: ${a.body.summary.map((s) => s.text).join(" ")}`,
    `Similar records: ${t.evidence.map((e) => e.ref).join(", ")}`,
    `Status: ${a.trust.conflicting ? "Investigation in progress. No permanent root cause confirmed." : "See cited records."}`,
    `Next actions: ${a.body.steps.slice(0, 3).map((s) => s.title.replace(/\.$/, "")).join("; ")}.`,
    `Confidence: ${a.confidence.level}. ${a.confidence.why}`,
  ].join("\n");
}

function NotHelpful({ onDone, onCancel }: { onDone: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fb-box">
      <b>What was wrong with this answer?</b>
      <div className="chip-row">{["Not relevant", "Missing a source", "Incorrect", "Out of date", "Too long"].map((x) => <button key={x} type="button" className={"chip " + (reason === x ? "chip-on" : "")} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
      <div className="row-end"><Btn size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn><Btn size="sm" variant="primary" disabled={!reason} onClick={() => onDone(reason)}>Send feedback</Btn></div>
    </div>
  );
}

export function EvidenceCard({ r, compact }: { r: RecordCard; compact?: boolean }) {
  const { openRecord } = useShell();
  return (
    <div className="ev-card">
      <div className="ev-top">
        <SourceIcon source={r.sourceSystem} size={15} />
        <div className="ev-meta"><span className="mono">{r.ref}</span><span className="muted small">{r.sourceSystem} · {typeText(r.recordType)}</span></div>
        <Similarity value={r.similarity} />
      </div>
      <button type="button" className="ev-title" onClick={() => openRecord(r.id)}>{r.title}</button>
      {!compact && (r.rootCause || r.resolution) && (
        <dl className="ev-dl">
          {r.rootCause && <><dt>Root cause</dt><dd>{r.rootCause}</dd></>}
          {r.resolution && <><dt>{r.evidenceKind === "approved" ? "Covers" : "Resolution"}</dt><dd>{r.resolution}</dd></>}
        </dl>
      )}
      <div className="ev-foot">
        <KindBadge kind={r.evidenceKind} />
        {r.status && <StatusPill status={r.status} />}
        {r.links.length > 0 && <Badge tone="neutral" icon="link">Linked to {r.links.slice(0, 2).join(", ")}</Badge>}
      </div>
      {r.evidenceKind === "historical" && !compact && <p className="ev-note"><Icon name="info" size={13} />This resolution is historical and has not been approved as reusable knowledge.</p>}
      {!compact && <div className="ev-actions"><Btn size="sm" variant="ghost" icon="eye" onClick={() => openRecord(r.id)}>Open cited source</Btn></div>}
    </div>
  );
}

function Insufficient({ t, onRefine }: { t: TurnState; onRefine: (q: string) => void }) {
  const { openRecord } = useShell();
  const router = useRouter();
  const why = { filters: "Active filters or the spaces you chose may be excluding the relevant records.", model: "The records found don't answer this question directly.", "no-evidence": "No records you are authorized to see matched closely enough." }[t.insufficient!.reason] ?? "";
  return (
    <div className="answer">
      <div className="answer-head"><span className="ai-mark muted-mark"><Icon name="search" size={16} /></span><b>No reliable answer found</b></div>
      <Callout tone="info" title="Synora could not find enough authorized evidence to provide a reliable answer.">{why}</Callout>
      <div className="row-wrap">
        <Btn size="sm" icon="edit" onClick={() => onRefine(t.q)}>Refine search</Btn>
        <Btn size="sm" icon="similar" onClick={() => router.push(`/similar?q=${encodeURIComponent(t.q)}`)}>Try Similar Issues</Btn>
      </div>
      {t.insufficient!.records.length > 0 && <><p className="label">Possibly related</p><ul className="rec-list">{t.insufficient!.records.map((r) => <RecordRow key={r.id} r={r} onOpen={() => openRecord(r.id)} />)}</ul></>}
    </div>
  );
}

export function RecordRow({ r, onOpen }: { r: RecordCard; onOpen: () => void }) {
  return (
    <li className="rec-row">
      <SourceIcon source={r.sourceSystem} size={15} />
      <button type="button" className="rec-main" onClick={onOpen}>
        <span className="rec-title">{r.title}</span>
        <span className="muted small"><span className="mono">{r.ref}</span> · {r.sourceSystem} · {r.application ?? r.space} · {fmtDate(r.updatedAt)}</span>
      </button>
      <div className="rec-badges"><KindBadge kind={r.evidenceKind} />{r.status && <StatusPill status={r.status} />}</div>
    </li>
  );
}

function RecordsView({ records, q }: { records: RecordCard[]; q: string }) {
  const { openRecord } = useShell();
  const [sort, setSort] = useState("relevance");
  const [type, setType] = useState("All");
  const types = ["All", ...new Set(records.map((r) => r.recordType))];
  let list = records.filter((r) => type === "All" || r.recordType === type);
  if (sort === "updated") list = list.slice().sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  if (!records.length) return <div className="answer"><Empty icon="search" title="No results">No records you can access match “{q}”.</Empty></div>;
  return (
    <div className="answer">
      <div className="answer-head"><span className="ai-mark"><Icon name="list" size={16} /></span><b>{records.length} records</b><span className="muted small">Ranked by relevance · no AI summary in this mode</span></div>
      <div className="row-wrap">
        <div className="chip-row">{types.map((x) => <button key={x} type="button" className={"chip " + (type === x ? "chip-on" : "")} aria-pressed={type === x} onClick={() => setType(x)}>{x === "All" ? x : typeText(x)}</button>)}</div>
        <label className="inline-sel"><span className="muted small">Sort</span>
          <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value)}><option value="relevance">Relevance</option><option value="updated">Last updated</option></select></label>
      </div>
      <ul className="rec-list">{list.map((r) => <RecordRow key={r.id} r={r} onOpen={() => openRecord(r.id)} />)}</ul>
    </div>
  );
}
