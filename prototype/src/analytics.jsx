import { useApp, Icon, Btn, Drawer, DemoTag, StatusPill, Badge, fmtNum } from './ui.jsx';
import { TICKETS, ANALYTICS_MONTHS, APPLICATIONS, LOCATIONS, OWNER_GROUPS, PRIORITIES, CATEGORIES, ROOT_CAUSES, RECURRING_GROUPS, NO_ANSWER_SEARCHES } from './data.js';
import { BarList, TrendChart, Donut, StackBar } from './charts.jsx';

const { useState, useMemo } = React;

const A_FILTERS = [
  { key: 'range', label: 'Date', options: [['12', 'Last 12 months'], ['6', 'Last 6 months'], ['3', 'Last 3 months']] },
  { key: 'source', label: 'Source', options: ['HDA Ticketing', 'Azure DevOps', 'Outlook', 'Teams', 'SharePoint'] },
  { key: 'application', label: 'Application', options: APPLICATIONS },
  { key: 'location', label: 'Location', options: LOCATIONS },
  { key: 'ownerGroup', label: 'Owner group', options: OWNER_GROUPS },
  { key: 'priority', label: 'Priority', options: PRIORITIES },
  { key: 'category', label: 'Category', options: CATEGORIES },
  { key: 'status', label: 'Status', options: ['Open', 'In progress', 'Resolved', 'Closed'] },
];

const INIT = { range: '12', source: 'all', application: 'all', location: 'all', ownerGroup: 'all', priority: 'all', category: 'all', status: 'all' };

function countBy(list, key, order) {
  const m = {};
  list.forEach((t) => { const v = t[key]; if (v != null) m[v] = (m[v] || 0) + 1; });
  const keys = order ? order.filter((k) => m[k]) : Object.keys(m);
  return keys.map((k) => ({ label: k, value: m[k] })).sort((a, b) => (order ? 0 : b.value - a.value));
}

export function AnalyticsPage() {
  const app = useApp();
  const [f, setF] = useState(INIT);
  const [drill, setDrill] = useState(null);

  const list = useMemo(() => TICKETS.filter((t) => {
    if (t.month < 12 - +f.range) return false;
    for (const k of Object.keys(f)) if (k !== 'range' && f[k] !== 'all' && t[k] !== f[k]) return false;
    return true;
  }), [f]);

  const months = ANALYTICS_MONTHS.slice(12 - +f.range);
  const trend = months.map((_, i) => list.filter((t) => t.month === 12 - +f.range + i).length);
  const recurring = countBy(list.filter((t) => t.recurring), 'recurring').slice(0, 6);
  const groups = new Set(list.filter((t) => t.recurring).map((t) => t.recurring));
  const openCritical = list.filter((t) => t.priority === 'P1 – Critical' && (t.status === 'Open' || t.status === 'In progress')).length;
  const noSolution = list.filter((t) => !t.solution).length;
  const reuse = countBy(list, 'reuse', ['Reused approved knowledge', 'Reused historical fix', 'New resolution', 'No resolution']);
  const activeSources = app.connectors.filter((c) => c.status === 'Connected' || c.status === 'Syncing').length;
  const indexed = app.connectors.reduce((a, c) => a + (c.records || 0), 0);
  const gaps = RECURRING_GROUPS.map((g) => ({ g, n: list.filter((t) => t.recurring === g).length, kb: ['Print spooler hang', 'Order launch – missing catalogue', 'ECM API 504 at month-end'].includes(g) }))
    .filter((x) => !x.kb && x.n > 0).sort((a, b) => b.n - a.n);
  const nActive = Object.keys(f).filter((k) => k !== 'range' && f[k] !== 'all').length;

  const open = (title, pred) => setDrill({ title, rows: list.filter(pred) });

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Analytics</h1><p className="muted">Recurring issues, knowledge coverage and source activity.</p></div>
        <div className="row-wrap tight"><DemoTag>Demonstration data – not from live systems</DemoTag>
          <Btn size="sm" icon="download" onClick={() => app.toast('Report export prepared (demonstration – no file is created)')}>Export report</Btn></div>
      </header>

      <div className="a-filters" role="group" aria-label="Analytics filters">
        {A_FILTERS.map((x) => (
          <label key={x.key} className="a-filter">
            <span>{x.label}</span>
            <select className="input input-sm" value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })}>
              {x.key !== 'range' && <option value="all">All</option>}
              {x.options.map((o) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        {(nActive > 0 || f.range !== '12') && <button type="button" className="link-btn" onClick={() => setF(INIT)}>Reset</button>}
      </div>

      <div className="kpis">
        <Kpi label="Total indexed records" value={fmtNum(indexed)} note="Across all connected sources" onClick={() => app.navigate('sources')} />
        <Kpi label="Recurring issue groups" value={groups.size} note={`${list.filter((t) => t.recurring).length} linked tickets`} onClick={() => open('Tickets in recurring groups', (t) => t.recurring)} />
        <Kpi label="Open critical incidents" value={openCritical} tone={openCritical ? 'bad' : 'good'} note="P1, open or in progress" onClick={() => open('Open critical incidents', (t) => t.priority === 'P1 – Critical' && (t.status === 'Open' || t.status === 'In progress'))} />
        <Kpi label="Without a documented solution" value={noSolution} tone="warn" note={`${list.length ? Math.round((noSolution / list.length) * 100) : 0}% of filtered tickets`} onClick={() => open('Tickets without a documented solution', (t) => !t.solution)} />
        <Kpi label="Approved knowledge articles" value="312" note="18 awaiting review" onClick={() => app.navigate('admin', { section: 'governance' })} />
        <Kpi label="Active data sources" value={`${activeSources} / ${app.connectors.length}`} note="Connected or syncing" onClick={() => app.navigate('sources')} />
      </div>

      <div className="a-grid">
        <Card title="Ticket volume trend" sub={`${list.length} tickets · select a month to drill in`} wide>
          {list.length ? <TrendChart data={trend} labels={months} onSelect={(i) => open(`Tickets in ${months[i]}`, (t) => t.month === 12 - +f.range + i)} /> : <p className="muted small">No tickets match these filters.</p>}
        </Card>
        <Card title="Top recurring issues" sub="Tickets per recurring group">
          <BarList data={recurring} unit="tickets" onSelect={(d) => open(d.label, (t) => t.recurring === d.label)} />
        </Card>
        <Card title="Issues by application">
          <BarList data={countBy(list, 'application').slice(0, 8)} unit="tickets" onSelect={(d) => open(`Application: ${d.label}`, (t) => t.application === d.label)} />
        </Card>
        <Card title="Issues by source">
          <BarList data={countBy(list, 'source')} unit="tickets" onSelect={(d) => open(`Source: ${d.label}`, (t) => t.source === d.label)} />
        </Card>
        <Card title="Issues by priority">
          <BarList data={countBy(list, 'priority', PRIORITIES)} unit="tickets" onSelect={(d) => open(`Priority: ${d.label}`, (t) => t.priority === d.label)} />
        </Card>
        <Card title="Issues by owner group">
          <BarList data={countBy(list, 'ownerGroup')} unit="tickets" onSelect={(d) => open(`Owner group: ${d.label}`, (t) => t.ownerGroup === d.label)} />
        </Card>
        <Card title="Root-cause distribution">
          <Donut data={countBy(list, 'rootCause', ROOT_CAUSES)} centerLabel="tickets" onSelect={(d) => open(`Root cause: ${d.label}`, (t) => t.rootCause === d.label)} />
        </Card>
        <Card title="Resolution reuse" sub="How tickets were resolved">
          <StackBar data={reuse} onSelect={(d) => open(d.label, (t) => t.reuse === d.label)} />
        </Card>
        <Card title="Knowledge gaps" sub="Recurring groups with no approved article">
          <ul className="gap-list">
            {gaps.map((x) => (
              <li key={x.g}><button type="button" onClick={() => open(`Knowledge gap: ${x.g}`, (t) => t.recurring === x.g)}>
                <Icon name="alert" size={15} /><span className="grow">{x.g}</span><span className="num muted">{x.n} tickets</span><Icon name="right" size={14} /></button></li>
            ))}
            {!gaps.length && <li className="muted small">No gaps for these filters.</li>}
          </ul>
        </Card>
        <Card title="Searches with no useful answer" sub="Last 30 days">
          <ul className="gap-list">
            {NO_ANSWER_SEARCHES.filter((s) => f.application === 'all' || s.app === f.application).map((s) => (
              <li key={s.q}><button type="button" onClick={() => app.runSearch(s.q, 'ask')}>
                <Icon name="search" size={15} /><span className="grow">{s.q}</span><span className="num muted">{s.count}×</span><Icon name="right" size={14} /></button></li>
            ))}
          </ul>
        </Card>
      </div>

      {drill && (
        <Drawer title={drill.title} onClose={() => setDrill(null)} wide>
          <p className="muted small">{drill.rows.length} underlying records · demonstration data</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reference</th><th>Application</th><th>Location</th><th>Priority</th><th>Status</th><th>Root cause</th></tr></thead>
              <tbody>
                {drill.rows.slice(0, 60).map((t) => (
                  <tr key={t.id}><td className="mono">{t.ref}</td><td>{t.application}</td><td>{t.location}</td><td>{t.priority}</td><td><StatusPill status={t.status} /></td><td>{t.rootCause}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {drill.rows.length > 60 && <p className="muted small">Showing 60 of {drill.rows.length}.</p>}
        </Drawer>
      )}
    </div>
  );
}

function Kpi({ label, value, note, tone, onClick }) {
  return (
    <button type="button" className={'kpi ' + (tone ? 'kpi-' + tone : '')} onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-val num">{value}</span>
      <span className="muted small">{note}</span>
    </button>
  );
}

function Card({ title, sub, children, wide }) {
  return (
    <section className={'card ' + (wide ? 'card-wide' : '')}>
      <header className="card-head"><h2>{title}</h2>{sub && <span className="muted small">{sub}</span>}</header>
      {children}
    </section>
  );
}
