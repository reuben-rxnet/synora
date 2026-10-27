import { useApp, Icon, Btn, Badge, Modal, Callout, Empty, Similarity, StatusPill, SourceIcon, DemoTag, KindBadge } from './ui.jsx';
import { SIMILAR_ISSUES, CURRENT_ISSUE, APPLICATIONS, ENVIRONMENTS, recordById } from './data.js';
import { fmtDate } from './search.jsx';

const { useState } = React;

const SIM_SOURCES = ['HDA Ticketing', 'Azure DevOps', 'Teams', 'Outlook'];

export function SimilarPage() {
  const app = useApp();
  const [desc, setDesc] = useState('RxCNC connections work after a server restart but begin timing out again after a few hours. Dallas lab, production. Error: Socket read timed out after 30000 ms.');
  const [appSel, setAppSel] = useState('RxCNC');
  const [env, setEnv] = useState('Production');
  const [srcs, setSrcs] = useState(SIM_SOURCES);
  const [threshold, setThreshold] = useState(60);
  const [ran, setRan] = useState({ desc, appSel, env, srcs, threshold });
  const [loading, setLoading] = useState(false);
  const [compare, setCompare] = useState(null);

  const run = () => {
    setLoading(true);
    setTimeout(() => { setRan({ desc, appSel, env, srcs, threshold }); setLoading(false); }, 650);
  };

  const results = SIMILAR_ISSUES.map((s) => ({ ...s, rec: recordById(s.recordId) }))
    .filter((s) => s.rec.similarity >= ran.threshold && ran.srcs.includes(s.rec.source))
    .filter((s) => ran.appSel === 'Any' || s.rec.application === ran.appSel || s.rec.similarity >= 80)
    .filter(() => /rxcnc|timeout|timing|restart|connect/i.test(ran.desc));

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Similar Issues</h1><p className="muted">Compare a current incident with historical tickets, bugs and discussions.</p></div>
        <DemoTag />
      </header>
      <div className="similar-layout">
        <form className="panel sim-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <label className="label" htmlFor="sim-desc">Incident description</label>
          <textarea id="sim-desc" className="input" rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="grid-2">
            <div><label className="label" htmlFor="sim-app">Application</label>
              <select id="sim-app" className="input" value={appSel} onChange={(e) => setAppSel(e.target.value)}>{['Any'].concat(APPLICATIONS).map((a) => <option key={a}>{a}</option>)}</select></div>
            <div><label className="label" htmlFor="sim-env">Environment</label>
              <select id="sim-env" className="input" value={env} onChange={(e) => setEnv(e.target.value)}>{['Any'].concat(ENVIRONMENTS).map((a) => <option key={a}>{a}</option>)}</select></div>
          </div>
          <fieldset><legend className="label">Sources</legend>
            <div className="chip-row">{SIM_SOURCES.map((s) => (
              <button key={s} type="button" className={'chip ' + (srcs.includes(s) ? 'chip-on' : '')} aria-pressed={srcs.includes(s)}
                onClick={() => setSrcs(srcs.includes(s) ? srcs.filter((x) => x !== s) : srcs.concat(s))}>{srcs.includes(s) && <Icon name="check" size={13} />}{s}</button>
            ))}</div>
          </fieldset>
          <label className="label" htmlFor="sim-th">Similarity threshold <b className="num">{threshold}%</b></label>
          <input id="sim-th" type="range" min="40" max="95" step="5" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
          <Btn variant="primary" icon="search" type="submit" disabled={!desc.trim() || loading}>{loading ? 'Finding similar issues…' : 'Find similar issues'}</Btn>
        </form>

        <section className="sim-results" aria-live="polite" aria-busy={loading}>
          <div className="row-between">
            <h2 className="h3">{loading ? 'Searching…' : `${results.length} similar issue${results.length === 1 ? '' : 's'} above ${ran.threshold}%`}</h2>
            <Badge tone="info" icon="info">Ranked by symptom, error and environment match</Badge>
          </div>
          {loading && [0, 1, 2].map((i) => <div key={i} className="skeleton-card" />)}
          {!loading && !results.length && (
            <Empty icon="similar" title="No similar issues above this threshold" action={<Btn onClick={() => { setThreshold(40); setRan({ ...ran, threshold: 40 }); }}>Lower threshold to 40%</Btn>}>
              Try a lower threshold, more sources, or a fuller description with error messages.
            </Empty>
          )}
          {!loading && results.map((s, i) => (
            <article key={s.id} className="sim-card">
              <div className="sim-card-top">
                <span className="rank">#{i + 1}</span>
                <Similarity value={s.rec.similarity} />
                <div className="grow min0">
                  <div className="row-wrap tight"><span className="mono">{s.rec.ref}</span><StatusPill status={s.rec.status} /><KindBadge kind={s.rec.kind} /></div>
                  <h3 className="sim-title">{s.rec.title}</h3>
                </div>
              </div>
              <dl className="meta-grid">
                <div><dt>Source</dt><dd><SourceIcon source={s.rec.source} size={13} />{s.rec.source}</dd></div>
                <div><dt>Application</dt><dd>{s.rec.application}</dd></div>
                <div><dt>Location</dt><dd>{s.rec.location}</dd></div>
                <div><dt>Date</dt><dd>{fmtDate(s.rec.created)}</dd></div>
                {s.rec.recurrence > 0 && <div><dt>Recurrence</dt><dd>{s.rec.recurrence} times in 60 days</dd></div>}
              </dl>
              <div className="rc-grid">
                <div><span className="eyebrow">Root cause</span><p>{s.rec.rootCause || 'Not documented'}</p></div>
                <div><span className="eyebrow">Resolution</span><p>{s.rec.resolution && s.rec.resolution !== '—' ? s.rec.resolution : 'None recorded'}</p></div>
              </div>
              <div className="why">
                <span className="eyebrow">Why Synora considers it similar</span>
                <ul className="why-list">{s.why.map((w) => <li key={w}><Icon name="check" size={13} />{w}</li>)}</ul>
              </div>
              <div className="row-end">
                <Btn size="sm" variant="ghost" icon="eye" onClick={() => app.openRecord(s.rec.id)}>Open source</Btn>
                <Btn size="sm" icon="bookmark" onClick={() => app.saveItem({ kind: 'ticket', name: `${s.rec.ref} – ${s.rec.title.slice(0, 40)}`, recordId: s.rec.id, tags: ['similar'] })}>Pin</Btn>
                <Btn size="sm" variant="primary" icon="similar" onClick={() => setCompare(s)}>View comparison</Btn>
              </div>
            </article>
          ))}
        </section>
      </div>
      {compare && <CompareModal s={compare} onClose={() => setCompare(null)} />}
    </div>
  );
}

function CompareModal({ s, onClose }) {
  const app = useApp();
  const h = s.rec;
  const cur = CURRENT_ISSUE;
  const matchingErrors = cur.errors.filter((e) => (h.errors || []).includes(e));
  const riskTone = { High: 'bad', Medium: 'warn', Low: 'good' }[s.reuseRisk];
  const [done, setDone] = useState({});
  return (
    <Modal title="Issue comparison" subtitle={`Current issue vs. ${h.ref}`} onClose={onClose} size="xl"
      footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn icon="eye" onClick={() => app.openRecord(h.id)}>Open {h.ref}</Btn>
        <Btn variant="primary" icon="folder" onClick={() => { app.createCollection(`Comparison: ${h.ref}`, [h.id], cur.title); onClose(); }}>Add to investigation</Btn></>}>
      <div className="compare-cols">
        <div className="cmp-col cur">
          <span className="eyebrow">Current issue</span>
          <h3>{cur.title}</h3>
          <p className="muted small">{cur.application} · {cur.environment} · {cur.location} · {cur.build}</p>
        </div>
        <div className="cmp-col hist">
          <span className="eyebrow">Historical issue</span>
          <h3>{h.title}</h3>
          <p className="muted small"><span className="mono">{h.ref}</span> · {h.application} · {h.environment} · {h.location}</p>
        </div>
      </div>
      <div className="cmp-rows">
        <CmpRow label="Shared symptoms" tone="good">{s.shared.map((x) => <li key={x}><Icon name="check" size={13} />{x}</li>)}</CmpRow>
        <CmpRow label="Different symptoms" tone="warn">{s.different.map((x) => <li key={x}><Icon name="alert" size={13} />{x}</li>)}</CmpRow>
        <CmpRow label="Matching error messages">{matchingErrors.length ? matchingErrors.map((x) => <li key={x}><code>{x}</code></li>) : <li className="muted">No exact error match</li>}</CmpRow>
        <CmpRow label="Environment differences"><li>{s.envDiff}</li></CmpRow>
        <CmpRow label="Previous root cause"><li>{h.rootCause || 'Not documented'}</li></CmpRow>
        <CmpRow label="Previous resolution"><li>{h.resolution && h.resolution !== '—' ? h.resolution : 'None recorded'}</li></CmpRow>
      </div>
      <div className={'reuse c-' + riskTone}>
        <div><span className="eyebrow">Reuse risk</span><b>{s.reuseRisk}</b></div>
        <p>{s.reuseNote}</p>
      </div>
      <div className="panel-inner">
        <span className="eyebrow">Required validation</span>
        <ul className="check-list">
          {s.validation.map((v) => (
            <li key={v}><label className="check"><input type="checkbox" checked={!!done[v]} onChange={() => setDone({ ...done, [v]: !done[v] })} />{v}</label></li>
          ))}
        </ul>
      </div>
      <Callout tone="info" title="Validate before applying">Synora never applies a previous resolution automatically. Complete the validation and agree the change with the owner group.</Callout>
    </Modal>
  );
}

function CmpRow({ label, children, tone }) {
  return (
    <div className={'cmp-row ' + (tone ? 'cr-' + tone : '')}>
      <span className="cmp-label">{label}</span>
      <ul className="cmp-val">{children}</ul>
    </div>
  );
}
