import { useApp, Icon, Btn, IconBtn, Badge, KindBadge, Popover, Modal, Callout, Empty, Similarity, StatusPill, SourceIcon, Logo, DemoTag, copyText } from './ui.jsx';
import { SOURCES, SUGGESTED_PROMPTS, RECENT_ITEMS, DEMO_QUERY, recordById, EVIDENCE_KINDS } from './data.js';
import { runQuery, searchRecords } from './engine.js';
import { FilterChips } from './filters.jsx';

const { useState, useEffect, useRef, useMemo } = React;

export const MODES = [
  { value: 'ask', label: 'Ask Synora', icon: 'sparkles', ph: 'Describe an issue or ask a question about connected enterprise knowledge…' },
  { value: 'records', label: 'Search Records', icon: 'list', ph: 'Search tickets, documents, emails and work items by keyword or reference…' },
  { value: 'similar', label: 'Find Similar Issues', icon: 'similar', ph: 'Paste the incident description to find similar historical issues…' },
  { value: 'investigate', label: 'Investigate Incident', icon: 'target', ph: 'Describe the incident: symptoms, timing, environment and error messages…' },
];

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let turnSeq = 0;

export function SearchPage() {
  const app = useApp();
  const [query, setQuery] = useState(DEMO_QUERY);
  const [mode, setMode] = useState('ask');
  const [turns, setTurns] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const inputRef = useRef(null);
  const endRef = useRef(null);

  const submit = (text = query, m = mode) => {
    const q = text.trim();
    if (!q) { inputRef.current && inputRef.current.focus(); return; }
    const ctx = { filters: app.filters, sources: app.sources, scenario: app.scenario };
    const result = m === 'records' ? { state: 'records', records: searchRecords(q, ctx) } : runQuery(q, ctx);
    setTurns((t) => t.concat({ id: ++turnSeq, q, mode: m, result, attachment, filters: app.activeFilterCount }));
    app.addHistory(q);
    setQuery('');
    setAttachment(null);
  };

  // Searches requested from elsewhere (saved items, command palette, notifications).
  useEffect(() => {
    if (!app.searchRequest) return;
    const { q, mode: m = 'ask', fresh } = app.searchRequest;
    app.clearSearchRequest();
    setMode(m);
    if (fresh) setTurns([]);
    submit(q, m);
  }, [app.searchRequest]);

  useEffect(() => {
    if (turns.length && endRef.current && endRef.current.scrollIntoView) endRef.current.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [turns.length]);

  const newSearch = () => { setTurns([]); setQuery(''); setTimeout(() => inputRef.current && inputRef.current.focus(), 0); };
  const refine = (q) => { setQuery(q); setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(q.length, q.length); } }, 0); };

  const box = <SearchBox inputRef={inputRef} query={query} setQuery={setQuery} mode={mode} setMode={setMode} onSubmit={() => submit()} attachment={attachment} setAttachment={setAttachment} compact={turns.length > 0} />;

  if (!turns.length) {
    return (
      <div className="search-landing">
        <div className="landing-hero">
          <Logo size={52} />
          <h1>How can Synora help?</h1>
          <p className="muted">Search connected enterprise knowledge across tickets, documents, email and work items.</p>
        </div>
        {box}
        <section className="landing-section" aria-labelledby="sugg-h">
          <h2 id="sugg-h" className="eyebrow">Suggested</h2>
          <div className="prompt-grid">
            {SUGGESTED_PROMPTS.map((p) => (
              <button key={p} type="button" className="prompt-card" onClick={() => submit(p, mode)}>
                <Icon name={p.startsWith('Have we') ? 'similar' : p.startsWith('What') || p.startsWith('Summ') ? 'sparkles' : 'search'} size={16} />
                <span>{p}</span>
              </button>
            ))}
          </div>
        </section>
        <div className="landing-cols">
          <section className="landing-section" aria-labelledby="recent-h">
            <h2 id="recent-h" className="eyebrow">Recently viewed</h2>
            <ul className="recent-list">
              {RECENT_ITEMS.map(recordById).map((r) => (
                <li key={r.id}>
                  <button type="button" className="recent-item" onClick={() => app.openRecord(r.id)}>
                    <SourceIcon source={r.source} size={15} />
                    <span className="recent-text"><b>{r.title}</b><span className="muted small">{r.ref} · {r.source}</span></span>
                    <Icon name="right" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="landing-section" aria-labelledby="avail-h">
            <h2 id="avail-h" className="eyebrow">Available sources</h2>
            <ul className="avail-list">
              {app.connectors.filter((c) => c.status !== 'Not configured').map((c) => (
                <li key={c.id}>
                  <span className={'health-dot hd-' + healthTone(c.status)} aria-hidden="true" />
                  <span className="avail-name">{c.name}</span>
                  <span className="muted small">{c.status}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="link-btn" onClick={() => app.navigate('sources')}>Manage sources <Icon name="right" size={14} /></button>
          </section>
        </div>
        <p className="landing-foot"><DemoTag>All records shown are demonstration data</DemoTag></p>
      </div>
    );
  }

  return (
    <div className="search-thread">
      <div className="thread-bar">
        <Btn icon="plus" size="sm" onClick={newSearch}>New search</Btn>
        <DemoTag />
      </div>
      <div className="thread">
        {turns.map((t, i) => (
          <div key={t.id} ref={i === turns.length - 1 ? endRef : null} className="turn">
            <div className="q-bubble">
              <Badge tone="neutral" icon={MODES.find((m) => m.value === t.mode).icon}>{MODES.find((m) => m.value === t.mode).label}</Badge>
              <p>{t.q}</p>
              {t.attachment && <span className="attach-chip"><Icon name="paperclip" size={13} />{t.attachment.name}</span>}
            </div>
            <ResultView turn={t} onRefine={refine} onMode={(m) => submit(t.q, m)} />
          </div>
        ))}
      </div>
      <div className="dock">{box}</div>
    </div>
  );
}

export function healthTone(status) {
  return { Connected: 'good', Syncing: 'info', 'Action required': 'warn', Paused: 'muted', Failed: 'bad', 'Not configured': 'muted' }[status] || 'muted';
}

function SearchBox({ inputRef, query, setQuery, mode, setMode, onSubmit, attachment, setAttachment, compact }) {
  const app = useApp();
  const [srcOpen, setSrcOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const ph = MODES.find((m) => m.value === mode).ph;

  useEffect(() => {
    const fit = () => { const el = inputRef.current; if (!el || !el.offsetWidth) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px'; };
    const id = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', fit); };
  }, [query]);

  const srcLabel = app.sources.length === SOURCES.length ? 'All sources' : `${app.sources.length} source${app.sources.length === 1 ? '' : 's'}`;
  return (
    <div className={'searchbox-wrap ' + (compact ? 'compact' : '')}>
      <div className="mode-row" role="radiogroup" aria-label="Search mode">
        {MODES.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} className={'mode-pill ' + (mode === m.value ? 'active' : '')} onClick={() => { setMode(m.value); inputRef.current && inputRef.current.focus(); }}>
            <Icon name={m.icon} size={15} />{m.label}
          </button>
        ))}
      </div>
      <form className="searchbox" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <label htmlFor="main-search" className="sr-only">Search query</label>
        <textarea id="main-search" ref={inputRef} rows={compact ? 1 : 2} value={query} placeholder={ph}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }} />
        {attachment && (
          <div className="attach-row">
            <span className="attach-chip"><Icon name="paperclip" size={13} />{attachment.name}<button type="button" aria-label="Remove attachment" onClick={() => setAttachment(null)}><Icon name="x" size={13} /></button></span>
          </div>
        )}
        <div className="searchbox-tools">
          <div className="tools-left">
            <IconBtn icon="paperclip" label="Attach or paste incident details" onClick={() => setAttachOpen(true)} />
            <div className="rel">
              <button type="button" className="tool-btn" aria-haspopup="dialog" aria-expanded={srcOpen} onClick={() => setSrcOpen((o) => !o)}>
                <Icon name="layers" size={16} /><span className="tool-label">{srcLabel}</span><Icon name="chevDown" size={14} />
              </button>
              <Popover open={srcOpen} onClose={() => setSrcOpen(false)} align="left" className="src-pop">
                <SourcePicker />
              </Popover>
            </div>
            <button type="button" className="tool-btn" onClick={app.openFilters}>
              <Icon name="filter" size={16} /><span className="tool-label">Filters</span>{app.activeFilterCount ? <span className="count-pill">{app.activeFilterCount}</span> : null}
            </button>
            <div className="rel">
              <IconBtn icon="history" label="Search history" aria-expanded={histOpen} onClick={() => setHistOpen((o) => !o)} />
              <Popover open={histOpen} onClose={() => setHistOpen(false)} align="left" className="hist-pop">
                <h3 className="pop-title">Recent searches</h3>
                <ul className="hist-list">
                  {app.history.map((h, i) => (
                    <li key={i}><button type="button" onClick={() => { setQuery(h.q); setHistOpen(false); inputRef.current && inputRef.current.focus(); }}>
                      <Icon name="history" size={14} /><span>{h.q}</span><span className="muted small">{h.when}</span></button></li>
                  ))}
                </ul>
              </Popover>
            </div>
          </div>
          <div className="tools-right">
            {query && <IconBtn icon="x" label="Clear query" onClick={() => { setQuery(''); inputRef.current.focus(); }} />}
            <button type="submit" className="send-btn" aria-label="Submit search" disabled={!query.trim()}><Icon name="arrow" size={18} /></button>
          </div>
        </div>
      </form>
      <FilterChips />
      {attachOpen && <AttachModal onClose={() => setAttachOpen(false)} onAttach={(a, text) => { setAttachment(a); if (text) setQuery((q) => (q ? q + '\n' : '') + text); setAttachOpen(false); app.toast('Incident details attached'); }} />}
    </div>
  );
}

function SourcePicker() {
  const app = useApp();
  const status = (s) => {
    const m = { 'HDA Ticketing': 'c3', 'Azure DevOps': 'c4', SharePoint: 'c1', OneDrive: 'c2', Outlook: 'c5', Teams: 'c6', Confluence: 'c7' }[s];
    const c = app.connectors.find((x) => x.id === m);
    return c ? c.status : 'Connected';
  };
  const toggle = (s) => app.setSources(app.sources.includes(s) ? app.sources.filter((x) => x !== s) : app.sources.concat(s));
  return (
    <div>
      <div className="pop-head">
        <h3 className="pop-title">Search sources</h3>
        <button type="button" className="link-btn" onClick={() => app.setSources(app.sources.length === SOURCES.length ? [] : SOURCES.slice())}>
          {app.sources.length === SOURCES.length ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <ul className="check-list">
        {SOURCES.map((s) => (
          <li key={s}>
            <label className="check">
              <input type="checkbox" checked={app.sources.includes(s)} onChange={() => toggle(s)} />
              <SourceIcon source={s} size={14} />
              <span className="grow">{s}</span>
              <span className={'health-dot hd-' + healthTone(status(s))} title={status(s)} />
              <span className="sr-only">{status(s)}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="hint">Results only include records you are authorized to see.</p>
    </div>
  );
}

function AttachModal({ onClose, onAttach }) {
  const [text, setText] = useState('');
  const sample = 'Incident A5070112L – Dallas lab. 14:10 surfacing generators report "Socket read timed out after 30000 ms". RXCNC-APP02 restarted at 08:00; issue returned at 13:45. CLOSE_WAIT count 418.';
  return (
    <Modal title="Attach incident details" subtitle="Paste ticket text or attach the demonstration incident file." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!text.trim()} onClick={() => onAttach({ name: 'Pasted incident details' }, text.trim())}>Attach text</Btn></>}>
      <label htmlFor="attach-text" className="label">Incident details</label>
      <textarea id="attach-text" className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste symptoms, timestamps, error messages…" />
      <div className="attach-sample">
        <Icon name="file" size={18} />
        <div className="grow"><b>incident_A5070112L.txt</b><p className="muted small">Demonstration file · 1 KB</p></div>
        <Btn size="sm" onClick={() => onAttach({ name: 'incident_A5070112L.txt' }, sample)}>Attach file</Btn>
      </div>
    </Modal>
  );
}

// Progressive reveal driven by a finite step counter — no endless timers.
function useStream(total, key) {
  const [step, setStep] = useState(reduceMotion() ? total : 0);
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (stopped || step >= total) return;
    const id = setTimeout(() => setStep((s) => s + 1), step < 4 ? 380 : 55);
    return () => clearTimeout(id);
  }, [step, stopped, total]);
  return { step, done: step >= total, stopped, stop: () => setStopped(true), finish: () => { setStopped(false); setStep(total); } };
}

function ResultView({ turn, onRefine, onMode }) {
  const r = turn.result;
  if (r.state === 'unavailable') return <ServiceUnavailable onRetry={() => onMode(turn.mode)} />;
  if (r.state === 'insufficient') return <Insufficient result={r} q={turn.q} onRefine={onRefine} />;
  if (r.state === 'records') return <RecordsView records={r.records} q={turn.q} />;
  if (turn.mode === 'similar') return <SimilarInline result={r} q={turn.q} />;
  return <AnswerView turn={turn} onRefine={onRefine} onMode={onMode} />;
}

function Retrieving({ step }) {
  const items = ['Understanding the question', 'Searching 8 connected sources', 'Ranking evidence by relevance and permissions', 'Writing a source-backed answer'];
  return (
    <ol className="retrieve" aria-live="polite">
      {items.map((t, i) => (
        <li key={t} className={i < step ? 'done' : i === step ? 'now' : ''}>
          <span className="r-dot">{i < step ? <Icon name="check" size={12} /> : null}</span>{t}
        </li>
      ))}
    </ol>
  );
}

function Cite({ ids }) {
  const app = useApp();
  if (!ids || !ids.length) return null;
  return (
    <span className="cites">
      {ids.map((id) => {
        const rec = recordById(id);
        return (
          <button key={id} type="button" className={'cite k-' + rec.kind} onClick={() => app.openRecord(id)} aria-label={`Open source ${rec.ref}: ${rec.title}`} title={`${rec.ref} · ${EVIDENCE_KINDS[rec.kind].label}`}>
            {rec.ref}
          </button>
        );
      })}
    </span>
  );
}

function AnswerView({ turn, onRefine, onMode }) {
  const app = useApp();
  const r = turn.result;
  const investigate = turn.mode === 'investigate';
  const words = useMemo(() => r.summary.map((s) => s.t.split(/(\s+)/)), [r]);
  const totalWords = words.reduce((a, w) => a + w.length, 0);
  // Steps: 4 retrieval phases, then summary words (in chunks of 4), then 1 tick per section.
  const chunks = Math.ceil(totalWords / 4);
  const SECTIONS = 4;
  const s = useStream(4 + chunks + SECTIONS, turn.id);
  const revealed = Math.max(0, s.step - 4) * 4;
  const sec = s.step - 4 - chunks; // sections revealed
  const [feedback, setFeedback] = useState(null);
  const [fbOpen, setFbOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [checks, setChecks] = useState({});

  if (s.step < 4 && !s.stopped) {
    return (
      <div className="answer">
        <div className="answer-head"><span className="ai-mark"><Icon name="sparkles" size={16} /></span><b>Synora</b><span className="muted small">Searching…</span>
          <Btn size="sm" variant="ghost" icon="stop" onClick={s.stop}>Stop</Btn></div>
        <Retrieving step={s.step} />
      </div>
    );
  }

  let left = revealed;
  const summaryNodes = r.summary.map((part, i) => {
    const w = words[i];
    const shown = s.done ? w.length : Math.max(0, Math.min(w.length, left));
    left -= w.length;
    return <span key={i}>{w.slice(0, shown).join('')}{shown === w.length && <Cite ids={part.cite} />}</span>;
  });

  const confTone = { High: 'good', Medium: 'warn', Low: 'bad' }[r.confidence];
  const plain = () => `Synora answer (demonstration data)\n\nQuestion: ${turn.q}\n\nIssue summary\n${r.summary.map((p) => p.t).join('')}\n\nRecommended next steps\n${r.steps.map((x, i) => `${i + 1}. ${x.t}`).join('\n')}\n\nConfidence: ${r.confidence}. ${r.why}${r.warning ? '\n\nImportant: ' + r.warning : ''}\n\nSources: ${r.evidence.map((id) => recordById(id).ref).join(', ')}`;
  const show = (n) => s.done || sec >= n;

  return (
    <article className="answer" aria-busy={!s.done}>
      <div className="answer-head">
        <span className="ai-mark"><Icon name="sparkles" size={16} /></span><b>Synora</b>
        {!s.done && !s.stopped && <><span className="muted small">Writing answer…</span><Btn size="sm" variant="ghost" icon="stop" onClick={s.stop}>Stop</Btn></>}
        {s.done && <span className="muted small">Synora found related historical evidence</span>}
      </div>

      {(show(1)) && <TrustBar r={r} />}

      <div className="answer-grid">
        <div className="answer-main">
          <section className="ans-sec">
            <h3>{investigate ? 'Incident summary' : 'Issue summary'} <KindBadge kind="ai" /></h3>
            <p className="summary">{summaryNodes}{!s.done && !s.stopped && <span className="caret" aria-hidden="true" />}</p>
          </section>

          {s.stopped && !s.done && (
            <Callout tone="info" title="Answer stopped" action={<Btn size="sm" onClick={s.finish}>Show full answer</Btn>}>The answer is incomplete. Evidence and confidence are not shown.</Callout>
          )}

          {show(1) && r.warning && (
            <Callout tone="warn" title="Validate before applying">{r.warning}</Callout>
          )}

          {show(1) && investigate && r.hypotheses && r.hypotheses.length > 0 && (
            <section className="ans-sec">
              <h3>Working hypotheses</h3>
              <ul className="hypo-list">
                {r.hypotheses.map(([h, st, c]) => (
                  <li key={h}>
                    <div><b>{h}</b><span className="muted small">{st}</span></div>
                    <Cite ids={c} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {show(1) && (
            <section className="ans-sec">
              <h3>{investigate ? 'Investigation checklist' : 'Recommended next steps'}</h3>
              <ol className="steps">
                {r.steps.map((st, i) => (
                  <li key={i}>
                    {investigate ? (
                      <label className="step-check">
                        <input type="checkbox" checked={!!checks[i]} onChange={() => setChecks((c) => ({ ...c, [i]: !c[i] }))} />
                        <span><b>{st.t}</b>{st.d && <span className="muted"> {st.d}</span>}</span>
                      </label>
                    ) : (
                      <span><b>{st.t}</b>{st.d && <span className="muted"> {st.d}</span>}</span>
                    )}
                    <Cite ids={st.cite} />
                  </li>
                ))}
              </ol>
              {investigate && <p className="muted small">{Object.values(checks).filter(Boolean).length} of {r.steps.length} checks completed</p>}
            </section>
          )}
        </div>

        {show(2) && (
          <aside className="answer-side" aria-label="Supporting evidence">
            <div className="side-head"><h3>Evidence from previous cases</h3><span className="muted small">{r.evidence.length} of {r.totalRelated}</span></div>
            {r.evidence.map((id) => <EvidenceCard key={id} rec={recordById(id)} />)}
            {r.related.length > 0 && <button type="button" className="link-btn" onClick={() => setModal('related')}>View all {r.totalRelated} related records <Icon name="right" size={14} /></button>}
          </aside>
        )}
      </div>

      {show(3) && (
        <section className={'confidence c-' + confTone}>
          <div className="conf-gauge" aria-hidden="true">{['Low', 'Medium', 'High'].map((l) => <span key={l} className={'seg ' + (['Low', 'Medium', 'High'].indexOf(l) <= ['Low', 'Medium', 'High'].indexOf(r.confidence) ? 'on' : '')} />)}</div>
          <div><b>{r.confidence} confidence</b><p>{r.why}</p></div>
        </section>
      )}

      {show(4) && (
        <div className="answer-actions" role="toolbar" aria-label="Answer actions">
          <IconBtn icon="copy" label="Copy answer" onClick={async () => app.toast((await copyText(plain())) ? 'Answer copied' : 'Copy is blocked here. Select the text to copy it.', 'info')} />
          <IconBtn icon="bookmark" label="Save answer" onClick={() => app.saveItem({ kind: turn.mode === 'investigate' ? 'search' : 'answer', name: turn.q.slice(0, 60), query: turn.q, tags: [] })} />
          <IconBtn icon="up" label="Mark helpful" className={feedback === 'up' ? 'pressed' : ''} aria-pressed={feedback === 'up'} onClick={() => { setFeedback('up'); setFbOpen(false); app.toast('Thanks. Marked as helpful.'); }} />
          <IconBtn icon="down" label="Mark not helpful" className={feedback === 'down' ? 'pressed' : ''} aria-pressed={feedback === 'down'} onClick={() => { setFeedback('down'); setFbOpen(true); }} />
          <IconBtn icon="share" label="Share" onClick={() => setModal('share')} />
          <IconBtn icon="download" label="Export" onClick={() => setModal('export')} />
          <span className="act-sep" />
          <Btn size="sm" icon="edit" onClick={() => onRefine(turn.q)}>Refine search</Btn>
          {turn.mode !== 'investigate' && <Btn size="sm" icon="target" onClick={() => onMode('investigate')}>Investigate</Btn>}
          <Btn size="sm" icon="folder" onClick={() => setModal('investigation')}>Create investigation</Btn>
          <Btn size="sm" icon="file" onClick={() => setModal('summary')}>Generate incident summary</Btn>
        </div>
      )}
      {fbOpen && <NotHelpful onDone={() => { setFbOpen(false); app.toast('Feedback sent to the search quality team'); }} onCancel={() => setFbOpen(false)} />}

      {modal === 'related' && <RelatedModal ids={r.evidence.concat(r.related)} onClose={() => setModal(null)} />}
      {modal === 'share' && <ShareModal q={turn.q} onClose={() => setModal(null)} />}
      {modal === 'export' && <ExportModal onClose={() => setModal(null)} />}
      {modal === 'investigation' && <InvestigationModal q={turn.q} ids={r.evidence.concat(r.related)} onClose={() => setModal(null)} />}
      {modal === 'summary' && <SummaryModal r={r} q={turn.q} onClose={() => setModal(null)} />}
    </article>
  );
}

function TrustBar({ r }) {
  return (
    <ul className="trust" aria-label="Answer trust indicators">
      <li><Icon name="check" size={14} />Source-backed</li>
      <li><Icon name="layers" size={14} />{r.supporting} supporting · {r.totalRelated} related</li>
      <li><Icon name="clock" size={14} />Evidence updated {fmtDate(r.lastEvidence)}</li>
      <li className={r.approvedCount ? 't-good' : 't-warn'}><Icon name={r.approvedCount ? 'book' : 'alert'} size={14} />{r.approvedCount ? `${r.approvedCount} approved article${r.approvedCount > 1 ? 's' : ''}` : 'No approved knowledge'}</li>
      <li><Icon name="lock" size={14} />Permission-aware</li>
      {r.intent === 'rxcnc' && <li className="t-warn"><Icon name="alert" size={14} />Conflicting evidence: restart vs. permanent fix</li>}
      {r.hasEmail && <li className="t-warn"><Icon name="clock" size={14} />Stale: Outlook last synced Oct 25</li>}
      {r.partial && <li className="t-warn"><Icon name="filter" size={14} />Partial results</li>}
      {r.unauthorized && <li className="t-warn"><Icon name="lock" size={14} />2 records hidden by permissions</li>}
    </ul>
  );
}

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function EvidenceCard({ rec, compact }) {
  const app = useApp();
  return (
    <div className="ev-card">
      <div className="ev-top">
        <SourceIcon source={rec.source} size={15} />
        <div className="ev-meta">
          <span className="mono">{rec.ref}</span>
          <span className="muted small">{rec.source} · {rec.type}</span>
        </div>
        {rec.similarity > 0 && <Similarity value={rec.similarity} />}
      </div>
      <button type="button" className="ev-title" onClick={() => app.openRecord(rec.id)}>{rec.title}</button>
      {!compact && (
        <dl className="ev-dl">
          {rec.kind === 'historical' && <><dt>Symptom</dt><dd>{rec.symptom || rec.excerpt.slice(0, 110) + '…'}</dd><dt>Resolution</dt><dd>{rec.resolution}</dd></>}
          {rec.kind === 'devwork' && <><dt>Finding</dt><dd>{rec.rootCause}</dd></>}
          {rec.kind === 'approved' && <><dt>Covers</dt><dd>{rec.resolution}</dd></>}
          {rec.kind === 'email' && <><dt>Discussion</dt><dd>{rec.excerpt.slice(0, 110)}…</dd></>}
        </dl>
      )}
      <div className="ev-foot">
        <KindBadge kind={rec.kind} />
        <StatusPill status={rec.status} />
        {rec.linkedTo && <Badge tone="neutral" icon="link">Linked to {rec.linkedTo}</Badge>}
      </div>
      {rec.kind === 'historical' && !compact && <p className="ev-note"><Icon name="info" size={13} />This resolution is historical and has not been approved as reusable knowledge.</p>}
      <div className="ev-actions">
        <Btn size="sm" variant="ghost" icon="eye" onClick={() => app.openRecord(rec.id)}>Open cited source</Btn>
      </div>
    </div>
  );
}

function NotHelpful({ onDone, onCancel }) {
  const [reason, setReason] = useState('');
  const reasons = ['Not relevant', 'Missing a source', 'Incorrect', 'Too long'];
  return (
    <div className="fb-box">
      <b>What was wrong with this answer?</b>
      <div className="chip-row">{reasons.map((x) => <button key={x} type="button" className={'chip ' + (reason === x ? 'chip-on' : '')} aria-pressed={reason === x} onClick={() => setReason(x)}>{x}</button>)}</div>
      <div className="row-end"><Btn size="sm" variant="ghost" onClick={onCancel}>Cancel</Btn><Btn size="sm" variant="primary" disabled={!reason} onClick={onDone}>Send feedback</Btn></div>
    </div>
  );
}

function RelatedModal({ ids, onClose }) {
  const app = useApp();
  return (
    <Modal title="Related records" subtitle={`${ids.length} records · demonstration data`} onClose={onClose} size="lg">
      <ul className="rec-list">
        {ids.map(recordById).map((r) => <RecordRow key={r.id} r={r} onOpen={() => { onClose(); app.openRecord(r.id); }} />)}
      </ul>
    </Modal>
  );
}

export function RecordRow({ r, onOpen }) {
  return (
    <li className="rec-row">
      <SourceIcon source={r.source} size={15} />
      <button type="button" className="rec-main" onClick={onOpen}>
        <span className="rec-title">{r.title}</span>
        <span className="muted small"><span className="mono">{r.ref}</span> · {r.source} · {r.application} · {fmtDate(r.updated)}</span>
      </button>
      <div className="rec-badges"><KindBadge kind={r.kind} /><StatusPill status={r.status} /></div>
    </li>
  );
}

function ShareModal({ q, onClose }) {
  const app = useApp();
  const link = 'https://synora.demo/answers/RX-2210-7Q';
  const [people, setPeople] = useState('');
  return (
    <Modal title="Share answer" subtitle="Recipients only see sources they are authorized to access." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn variant="primary" disabled={!people.trim()} onClick={() => { onClose(); app.toast(`Shared with ${people.split(',').length} recipient(s) (demonstration)`); }}>Share</Btn></>}>
      <label className="label" htmlFor="share-to">Share with people or groups</label>
      <input id="share-to" className="input" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="App Support – Lab Systems, Priya Natarajan" />
      <label className="label" htmlFor="share-link">Link</label>
      <div className="row"><input id="share-link" className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} />
        <Btn icon="copy" onClick={async () => app.toast((await copyText(link)) ? 'Link copied' : 'Select the link to copy it')}>Copy</Btn></div>
      <p className="hint">Demonstration link. It does not open a real page.</p>
    </Modal>
  );
}

function ExportModal({ onClose }) {
  const app = useApp();
  const [fmt, setFmt] = useState('pdf');
  const [cites, setCites] = useState(true);
  return (
    <Modal title="Export answer" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="download" onClick={() => { onClose(); app.toast(`Export prepared as ${fmt.toUpperCase()} (demonstration – no file is created)`); }}>Export</Btn></>}>
      <fieldset className="radio-group"><legend className="label">Format</legend>
        {[['pdf', 'PDF report'], ['docx', 'Word document'], ['md', 'Markdown'], ['ticket', 'Ticket work note']].map(([v, l]) => (
          <label key={v} className="radio"><input type="radio" name="fmt" checked={fmt === v} onChange={() => setFmt(v)} />{l}</label>
        ))}
      </fieldset>
      <label className="check"><input type="checkbox" checked={cites} onChange={() => setCites(!cites)} />Include citations and evidence excerpts</label>
    </Modal>
  );
}

function InvestigationModal({ q, ids, onClose }) {
  const app = useApp();
  const [name, setName] = useState('RxCNC timeouts after restart – Dallas');
  const [owner, setOwner] = useState('App Support – Lab Systems');
  return (
    <Modal title="Create investigation" subtitle="Groups this answer and its evidence into a collection you can share." onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!name.trim()} onClick={() => { app.createCollection(name, ids, q); onClose(); }}>Create</Btn></>}>
      <label className="label" htmlFor="inv-name">Name</label>
      <input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label" htmlFor="inv-owner">Owner group</label>
      <input id="inv-owner" className="input" value={owner} onChange={(e) => setOwner(e.target.value)} />
      <p className="label">Included</p>
      <ul className="mini-list">{ids.map(recordById).map((r) => <li key={r.id}><span className="mono">{r.ref}</span> {r.title}</li>)}</ul>
    </Modal>
  );
}

function SummaryModal({ r, q, onClose }) {
  const app = useApp();
  const text = `Incident summary (draft – demonstration data)
Reported issue: ${q}
Pattern: ${r.summary.map((p) => p.t).join('').trim()}
Similar records: ${r.evidence.map((id) => recordById(id).ref).join(', ')}
Current status: Investigation in progress. No permanent root cause confirmed.
Next actions: ${r.steps.slice(0, 3).map((s) => s.t.replace(/\.$/, '')).join('; ')}.
Confidence: ${r.confidence}. ${r.why}`;
  return (
    <Modal title="Incident summary" subtitle="AI-generated draft. Review before adding to a ticket." onClose={onClose} size="lg"
      footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn icon="copy" onClick={async () => app.toast((await copyText(text)) ? 'Summary copied' : 'Select the text to copy it')}>Copy</Btn><Btn variant="primary" icon="ticket" onClick={() => { onClose(); app.toast('Added as a work note draft (demonstration)'); }}>Add to ticket</Btn></>}>
      <KindBadge kind="ai" />
      <pre className="summary-pre">{text}</pre>
    </Modal>
  );
}

function Insufficient({ result, q, onRefine }) {
  const app = useApp();
  const why = {
    filters: 'Active filters or source selection may be excluding the relevant records.',
    confidence: `The best answer had ${result.confidence ? result.confidence.toLowerCase() : 'low'} confidence, below your minimum confidence filter.`,
    scenario: 'Demonstration scenario: insufficient evidence.',
    none: 'No authorized records matched closely enough.',
  }[result.reason];
  return (
    <div className="answer">
      <div className="answer-head"><span className="ai-mark muted-mark"><Icon name="search" size={16} /></span><b>No reliable answer found</b></div>
      <Callout tone="info" title="Synora could not find enough authorized evidence to provide a reliable answer.">{why}</Callout>
      <div className="row-wrap">
        <Btn size="sm" icon="edit" onClick={() => onRefine(q)}>Refine search</Btn>
        {app.activeFilterCount > 0 && <Btn size="sm" icon="x" onClick={app.resetFilters}>Reset filters</Btn>}
        <Btn size="sm" icon="similar" onClick={() => app.navigate('similar')}>Try Similar Issues</Btn>
      </div>
      {result.records && result.records.length > 0 && (
        <><p className="label">Possibly related</p><ul className="rec-list">{result.records.map((r) => <RecordRow key={r.id} r={r} onOpen={() => app.openRecord(r.id)} />)}</ul></>
      )}
    </div>
  );
}

function ServiceUnavailable({ onRetry }) {
  const app = useApp();
  return (
    <div className="answer">
      <Callout tone="bad" title="Search service unavailable" action={<Btn size="sm" icon="refresh" onClick={() => { app.setScenario('normal'); onRetry(); }}>Retry</Btn>}>
        Synora could not reach the answer service. Your question was not lost. Retry, or check System health in Administration.
      </Callout>
    </div>
  );
}

function RecordsView({ records, q }) {
  const app = useApp();
  const [sort, setSort] = useState('relevance');
  const [type, setType] = useState('All');
  const types = ['All'].concat([...new Set(records.map((r) => r.type))]);
  let list = records.filter((r) => type === 'All' || r.type === type);
  if (sort === 'updated') list = list.slice().sort((a, b) => b.updated.localeCompare(a.updated));
  if (!records.length) return <div className="answer"><Empty icon="search" title="No results">No records match “{q}” with the current filters.</Empty></div>;
  return (
    <div className="answer">
      <div className="answer-head"><span className="ai-mark"><Icon name="list" size={16} /></span><b>{records.length} records</b><span className="muted small">Ranked by relevance · no AI summary in this mode</span></div>
      <div className="row-wrap">
        <div className="chip-row">{types.map((t) => <button key={t} type="button" className={'chip ' + (type === t ? 'chip-on' : '')} aria-pressed={type === t} onClick={() => setType(t)}>{t}</button>)}</div>
        <label className="inline-sel"><span className="muted small">Sort</span>
          <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value)}><option value="relevance">Relevance</option><option value="updated">Last updated</option></select>
        </label>
      </div>
      <ul className="rec-list">{list.map((r) => <RecordRow key={r.id} r={r} onOpen={() => app.openRecord(r.id)} />)}</ul>
    </div>
  );
}

function SimilarInline({ result, q }) {
  const app = useApp();
  const recs = result.evidence.concat(result.related).map(recordById).filter((r) => r.type !== 'Document' && r.type !== 'Knowledge article')
    .sort((a, b) => b.similarity - a.similarity);
  return (
    <div className="answer">
      <div className="answer-head"><span className="ai-mark"><Icon name="similar" size={16} /></span><b>{recs.length} similar issues</b><span className="muted small">Ranked by similarity</span></div>
      <div className="sim-inline">
        {recs.map((r) => (
          <div key={r.id} className="sim-row">
            <Similarity value={r.similarity || 60} />
            <button type="button" className="rec-main" onClick={() => app.openRecord(r.id)}>
              <span className="rec-title">{r.title}</span>
              <span className="muted small"><span className="mono">{r.ref}</span> · {r.application} · {r.location} · {fmtDate(r.created)}</span>
              <span className="small"><b>Root cause:</b> {r.rootCause || 'Not documented'}</span>
            </button>
            <StatusPill status={r.status} />
          </div>
        ))}
      </div>
      <Callout tone="info">Never apply a previous resolution without validating it against the current issue.</Callout>
      <Btn variant="primary" iconRight="arrow" onClick={() => app.navigate('similar')}>Compare in Similar Issues</Btn>
    </div>
  );
}
