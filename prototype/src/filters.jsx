import { useApp, Icon, Btn, Drawer } from './ui.jsx';
import { SOURCES, APPLICATIONS, MODULES, ENVIRONMENTS, LOCATIONS, OWNER_GROUPS, PRIORITIES, CATEGORIES, STATUSES, RECORD_TYPES } from './data.js';

const { useState } = React;

export const FACETS = [
  { key: 'source', label: 'Source', options: SOURCES },
  { key: 'application', label: 'Application', options: APPLICATIONS },
  { key: 'module', label: 'Module', options: MODULES },
  { key: 'environment', label: 'Environment', options: ENVIRONMENTS },
  { key: 'location', label: 'Location', options: LOCATIONS },
  { key: 'ownerGroup', label: 'Owner group', options: OWNER_GROUPS },
  { key: 'priority', label: 'Priority', options: PRIORITIES },
  { key: 'category', label: 'Category', options: CATEGORIES },
  { key: 'status', label: 'Status', options: STATUSES.concat(['Published', 'Thread']) },
  { key: 'confidence', label: 'Minimum confidence', options: ['High', 'Medium', 'Low'] },
  { key: 'recordType', label: 'Record type', options: RECORD_TYPES },
];

export const DATE_OPTIONS = [['any', 'Any time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];

export const EMPTY_FILTERS = { date: 'any' };

export function countFilters(f) {
  return (f.date && f.date !== 'any' ? 1 : 0) + FACETS.reduce((a, x) => a + ((f[x.key] && f[x.key].length) || 0), 0);
}

export function FilterChips() {
  const app = useApp();
  const f = app.filters;
  const chips = [];
  if (f.date && f.date !== 'any') chips.push({ k: 'date', v: null, label: DATE_OPTIONS.find((d) => d[0] === f.date)[1] });
  FACETS.forEach((x) => (f[x.key] || []).forEach((v) => chips.push({ k: x.key, v, label: `${x.label}: ${v}` })));
  if (!chips.length) return null;
  const remove = (c) => app.setFilters(c.k === 'date' ? { ...f, date: 'any' } : { ...f, [c.k]: f[c.k].filter((x) => x !== c.v) });
  return (
    <div className="filter-chips" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.k + c.v} className="fchip">{c.label}
          <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => remove(c)}><Icon name="x" size={13} /></button>
        </span>
      ))}
      <button type="button" className="link-btn" onClick={app.resetFilters}>Reset all</button>
    </div>
  );
}

export function FilterPanel({ onClose }) {
  const app = useApp();
  const [draft, setDraft] = useState(app.filters);
  const [open, setOpen] = useState({ source: true, application: true });
  const toggle = (k, v) => {
    const cur = draft[k] || [];
    setDraft({ ...draft, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat(v) });
  };
  const n = countFilters(draft);
  return (
    <Drawer title="Filters" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={() => setDraft({ date: 'any' })}>Reset</Btn><Btn variant="primary" onClick={() => { app.setFilters(draft); onClose(); app.toast(n ? `${n} filter${n > 1 ? 's' : ''} applied` : 'Filters cleared'); }}>Apply{n ? ` (${n})` : ''}</Btn></>}>
      <div className="facet">
        <label className="label" htmlFor="f-date">Date range</label>
        <select id="f-date" className="input" value={draft.date || 'any'} onChange={(e) => setDraft({ ...draft, date: e.target.value })}>
          {DATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {FACETS.map((x) => {
        const sel = draft[x.key] || [];
        const isOpen = open[x.key] || sel.length > 0;
        return (
          <div key={x.key} className="facet">
            <button type="button" className="facet-head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [x.key]: !isOpen })}>
              <span>{x.label}{sel.length ? <span className="count-pill">{sel.length}</span> : null}</span>
              <Icon name="chevDown" size={16} className={isOpen ? 'rot' : ''} />
            </button>
            {isOpen && (
              <div className="chip-row">
                {x.options.map((o) => (
                  <button key={o} type="button" className={'chip ' + (sel.includes(o) ? 'chip-on' : '')} aria-pressed={sel.includes(o)} onClick={() => toggle(x.key, o)}>
                    {sel.includes(o) && <Icon name="check" size={13} />}{o}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </Drawer>
  );
}
