import { AppCtx, Icon, IconBtn, Btn, Badge, Logo, Drawer, Modal, Popover, Callout, KindBadge, StatusPill, SourceIcon, Toggle, DemoTag } from './ui.jsx';
import { SOURCES, CONNECTORS, NOTIFICATIONS, SAVED_INIT, COLLECTIONS_INIT, SEARCH_HISTORY, DEMO_USER, RECORDS, EVIDENCE_KINDS, recordById, connectorType } from './data.js';
import { SearchPage, healthTone, fmtDate, RecordRow } from './search.jsx';
import { FilterPanel, EMPTY_FILTERS, countFilters } from './filters.jsx';
import { SimilarPage } from './similar.jsx';
import { AnalyticsPage } from './analytics.jsx';
import { SourcesPage } from './sources.jsx';
import { SavedPage } from './saved.jsx';
import { AdminPage } from './admin.jsx';

const { useState, useEffect, useCallback, useRef } = React;

const NAV = [
  ['search', 'Search', 'search'], ['similar', 'Similar Issues', 'similar'], ['analytics', 'Analytics', 'chart'],
  ['sources', 'Sources', 'plug'], ['saved', 'Saved', 'bookmark'], ['admin', 'Administration', 'shield'],
];

let seq = 100;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } } };

export function App() {
  const [page, setPage] = useState('search');
  const [theme, setThemeState] = useState(store.get('synora-theme') || 'system');
  const [collapsed, setCollapsed] = useState(store.get('synora-collapsed') === '1');
  const [mobileNav, setMobileNav] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sources, setSources] = useState(SOURCES.slice());
  const [scenario, setScenario] = useState('normal');
  const [toasts, setToasts] = useState([]);
  const [recordId, setRecordId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [connectors, setConnectors] = useState(CONNECTORS);
  const [notes, setNotes] = useState(NOTIFICATIONS);
  const [saved, setSaved] = useState(SAVED_INIT);
  const [collections, setCollections] = useState(COLLECTIONS_INIT);
  const [history, setHistory] = useState(SEARCH_HISTORY);
  const [searchRequest, setSearchRequest] = useState(null);
  const [detail, setDetail] = useState({ id: null, tab: null });
  const [adminSection, setAdminSection] = useState('users');
  const [panel, setPanel] = useState(null); // profile | help | settings | palette

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    store.set('synora-theme', theme);
  }, [theme]);

  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPanel('palette'); }
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); setPage('search'); setTimeout(() => { const el = document.getElementById('main-search'); el && el.focus(); }, 0); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const toast = useCallback((msg, tone = 'good') => {
    const id = ++seq;
    setToasts((t) => t.concat({ id, msg, tone }));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const navigate = (p, opts = {}) => {
    setPage(p); setMobileNav(false); setRecordId(null);
    if (p === 'sources') setDetail({ id: opts.detailId || null, tab: null });
    if (p === 'admin' && opts.section) setAdminSection(opts.section);
    const main = document.getElementById('main'); if (main) main.scrollTop = 0;
  };

  const updateConnector = (id, patch) => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const app = {
    page, navigate, toast, filters, setFilters, resetFilters: () => setFilters(EMPTY_FILTERS), activeFilterCount: countFilters(filters),
    sources, setSources, scenario, setScenario, openFilters: () => setFiltersOpen(true), openRecord: setRecordId,
    connectors, updateConnector, history,
    addHistory: (q) => setHistory((h) => [{ q, when: 'Just now' }].concat(h.filter((x) => x.q !== q)).slice(0, 8)),
    searchRequest, clearSearchRequest: () => setSearchRequest(null),
    runSearch: (q, mode = 'ask', fresh = false) => { setSearchRequest({ q, mode, fresh }); navigate('search'); },
    saved, collections,
    saveItem: (item) => { setSaved((s) => [{ id: 'sv' + ++seq, when: 'Just now', collection: null, tags: [], ...item }].concat(s)); toast('Saved. Find it under Saved.'); },
    updateSaved: (id, patch) => setSaved((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    removeSaved: (ids) => { setSaved((s) => s.filter((x) => !ids.includes(x.id))); toast(`${ids.length} item${ids.length > 1 ? 's' : ''} removed`, 'info'); },
    groupSaved: (ids, target, name) => {
      let cid = target;
      if (target === 'new') { cid = 'col' + ++seq; setCollections((c) => c.concat({ id: cid, name })); }
      setSaved((s) => s.map((x) => (ids.includes(x.id) ? { ...x, collection: cid } : x)));
      toast('Added to collection');
    },
    createCollection: (name, recIds, q) => {
      const cid = 'col' + ++seq;
      setCollections((c) => c.concat({ id: cid, name, note: 'Created from Synora answer' }));
      const items = recIds.map(recordById).map((r) => ({ id: 'sv' + ++seq, kind: r.type === 'Document' || r.type === 'Knowledge article' ? 'document' : 'ticket', name: `${r.ref} – ${r.title.slice(0, 48)}`, recordId: r.id, tags: [], when: 'Just now', collection: cid }));
      setSaved((s) => [{ id: 'sv' + ++seq, kind: 'search', name: q.slice(0, 60), query: q, tags: ['investigation'], when: 'Just now', collection: cid }].concat(items, s));
      toast(`Investigation “${name}” created with ${recIds.length + 1} items`);
    },
    detailId: detail.id, detailTab: detail.tab, setDetailId: (id, tab = null) => setDetail({ id, tab }),
    adminSection, setAdminSection,
    syncConnector: (id) => {
      updateConnector(id, { status: 'Syncing' });
      toast('Sync started');
      setTimeout(() => setConnectors((cs) => cs.map((c) => (c.id === id && c.status === 'Syncing' ? { ...c, status: 'Connected', lastSync: 'Just now', records: c.records + 37, health: Math.max(c.health || 95, 95) } : c))), 2600);
    },
    togglePause: (id) => {
      const c = connectors.find((x) => x.id === id);
      const paused = c.status === 'Paused';
      updateConnector(id, { status: paused ? 'Connected' : 'Paused' });
      toast(paused ? `${c.name} resumed` : `${c.name} paused`, 'info');
    },
    fixConnector: (id) => {
      updateConnector(id, { status: 'Syncing', issue: null });
      toast('Re-authenticated (demonstration). Sync started.');
      setTimeout(() => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, status: 'Connected', lastSync: 'Just now', health: 96, records: c.records || 1840, failed: 0 } : c))), 2600);
    },
    deleteConnector: (id) => { const c = connectors.find((x) => x.id === id); setConnectors((cs) => cs.filter((x) => x.id !== id)); toast(`${c.name} deleted`, 'info'); },
    addConnector: ({ type, name, owner, replaceId }) => {
      const id = replaceId || 'c' + ++seq;
      const fresh = { id, type, name, status: 'Syncing', lastSync: 'In progress', records: 0, health: 100, owner, failed: 0, duration: '—', next: 'After first sync' };
      setConnectors((cs) => (replaceId ? cs.map((c) => (c.id === replaceId ? fresh : c)) : cs.concat(fresh)));
      toast(`${name} activated. First sync started.`);
      setTimeout(() => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, status: 'Connected', lastSync: 'Just now', records: 1200 + type.length * 517, duration: '3 min', next: 'In 1 hour' } : c))), 3200);
    },
  };

  const unread = notes.filter((n) => n.unread).length;
  const healthy = connectors.filter((c) => c.status === 'Connected' || c.status === 'Syncing').length;
  const attention = connectors.filter((c) => c.status === 'Action required' || c.status === 'Failed');

  return (
    <AppCtx.Provider value={app}>
      <a href="#main" className="skip">Skip to content</a>
      <div className={'shell ' + (collapsed ? 'collapsed' : '')}>
        <Sidebar page={page} navigate={navigate} collapsed={collapsed} mobileOpen={mobileNav} onClose={() => setMobileNav(false)}
          onToggle={() => { setCollapsed(!collapsed); store.set('synora-collapsed', collapsed ? '0' : '1'); }} openPanel={setPanel} />
        <div className="main-col">
          <header className="topbar">
            <IconBtn icon="menu" label="Open navigation" className="only-mobile" onClick={() => setMobileNav(true)} />
            <div className="brand-top only-mobile"><Logo size={24} /><b>Synora</b></div>
            <div className="top-title hide-mobile"><span className="tagline">Enterprise intelligence, connected.</span></div>
            <button type="button" className="kbd-search" onClick={() => setPanel('palette')} aria-label="Open global search">
              <Icon name="search" size={16} /><span className="hide-mobile">Search or jump to…</span><kbd className="hide-mobile">Ctrl K</kbd>
            </button>
            <div className="top-actions">
              <HealthIndicator healthy={healthy} total={connectors.length} attention={attention} navigate={navigate} setDetail={app.setDetailId} />
              <Notifications notes={notes} setNotes={setNotes} unread={unread} navigate={navigate} />
              <ThemeControl theme={theme} setTheme={setThemeState} />
              <button type="button" className="avatar-btn" aria-label="Open user profile" onClick={() => setPanel('profile')}><span className="avatar">{DEMO_USER.initials}</span></button>
            </div>
          </header>
          {scenario !== 'normal' && (
            <div className="scenario-bar" role="status"><Icon name="info" size={15} />Demo scenario active: <b>{SCENARIOS.find((s) => s[0] === scenario)[1]}</b>
              <button type="button" className="link-btn" onClick={() => setScenario('normal')}>Return to normal</button></div>
          )}
          <main id="main" className="main" tabIndex={-1}>
            <div hidden={page !== 'search'} className="page-search"><SearchPage /></div>
            {page === 'similar' && <SimilarPage />}
            {page === 'analytics' && <AnalyticsPage />}
            {page === 'sources' && <SourcesPage />}
            {page === 'saved' && <SavedPage />}
            {page === 'admin' && <AdminPage />}
          </main>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="Primary (mobile)">
        {NAV.slice(0, 5).map(([k, l, i]) => (
          <button key={k} type="button" className={page === k ? 'active' : ''} aria-current={page === k ? 'page' : undefined} onClick={() => navigate(k)}><Icon name={i} size={20} /><span>{l.split(' ')[0]}</span></button>
        ))}
      </nav>

      {recordId && <RecordDrawer id={recordId} onClose={() => setRecordId(null)} onOpen={setRecordId} />}
      {filtersOpen && <FilterPanel onClose={() => setFiltersOpen(false)} />}
      {panel === 'profile' && <Profile onClose={() => setPanel(null)} theme={theme} setTheme={setThemeState} />}
      {panel === 'help' && <Help onClose={() => setPanel(null)} />}
      {panel === 'settings' && <Settings onClose={() => setPanel(null)} theme={theme} setTheme={setThemeState} />}
      {panel === 'palette' && <Palette onClose={() => setPanel(null)} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={'toast t-' + t.tone}><Icon name={t.tone === 'info' ? 'info' : 'check'} size={16} />{t.msg}</div>)}
      </div>
    </AppCtx.Provider>
  );
}

function Sidebar({ page, navigate, collapsed, mobileOpen, onClose, onToggle, openPanel }) {
  return (
    <>
      {mobileOpen && <div className="nav-scrim" onClick={onClose} aria-hidden="true" />}
      <nav className={'sidebar ' + (mobileOpen ? 'open' : '')} aria-label="Primary">
        <div className="side-brand">
          <Logo size={30} />
          <div className="brand-text"><b>Synora</b><span>Enterprise intelligence, connected.</span></div>
          <IconBtn icon="x" label="Close navigation" className="only-mobile" onClick={onClose} />
        </div>
        <ul className="nav-list">
          {NAV.map(([k, l, i]) => (
            <li key={k}><button type="button" className={'nav-item ' + (page === k ? 'active' : '')} aria-current={page === k ? 'page' : undefined} onClick={() => navigate(k)} title={collapsed ? l : undefined}>
              <Icon name={i} size={19} /><span className="nav-label">{l}</span></button></li>
          ))}
        </ul>
        <div className="nav-bottom">
          <button type="button" className="nav-item" onClick={() => { onClose(); openPanel('help'); }} title={collapsed ? 'Help' : undefined}><Icon name="help" size={19} /><span className="nav-label">Help</span></button>
          <button type="button" className="nav-item" onClick={() => { onClose(); openPanel('settings'); }} title={collapsed ? 'Settings' : undefined}><Icon name="settings" size={19} /><span className="nav-label">Settings</span></button>
          <button type="button" className="nav-item nav-user" onClick={() => { onClose(); openPanel('profile'); }} title={collapsed ? 'User profile' : undefined}>
            <span className="avatar sm">{DEMO_USER.initials}</span><span className="nav-label"><b>{DEMO_USER.name}</b><span className="muted small">{DEMO_USER.role}</span></span></button>
          <button type="button" className="nav-item collapse-btn hide-mobile" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name="panel" size={19} /><span className="nav-label">Collapse</span></button>
        </div>
      </nav>
    </>
  );
}

function HealthIndicator({ healthy, total, attention, navigate, setDetail }) {
  const [open, setOpen] = useState(false);
  const tone = attention.some((c) => c.status === 'Failed') ? 'bad' : attention.length ? 'warn' : 'good';
  return (
    <div className="rel">
      <button type="button" className="health-btn" aria-expanded={open} aria-label={`Connection health: ${healthy} of ${total} sources healthy`} onClick={() => setOpen(!open)}>
        <span className={'health-dot hd-' + tone} /><span className="hide-mobile num">{healthy}/{total}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="health-pop">
        <h3 className="pop-title">Connection health</h3>
        <p className="muted small">{healthy} of {total} sources connected or syncing.</p>
        <ul className="hist-list">
          {attention.map((c) => (
            <li key={c.id}><button type="button" onClick={() => { setOpen(false); navigate('sources', { detailId: c.id }); }}>
              <span className={'health-dot hd-' + healthTone(c.status)} /><span>{c.name}</span><span className="muted small">{c.status}</span></button></li>
          ))}
        </ul>
        <button type="button" className="link-btn" onClick={() => { setOpen(false); navigate('sources'); }}>Open Sources <Icon name="right" size={14} /></button>
      </Popover>
    </div>
  );
}

function Notifications({ notes, setNotes, unread, navigate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rel">
      <IconBtn icon="bell" label={`Notifications, ${unread} unread`} badge={unread || null} aria-expanded={open} onClick={() => setOpen(!open)} />
      <Popover open={open} onClose={() => setOpen(false)} className="notif-pop">
        <div className="pop-head"><h3 className="pop-title">Notifications</h3>
          {unread > 0 && <button type="button" className="link-btn" onClick={() => setNotes(notes.map((n) => ({ ...n, unread: false })))}>Mark all read</button>}</div>
        <ul className="notif-list">
          {notes.map((n) => (
            <li key={n.id}><button type="button" className={n.unread ? 'unread' : ''} onClick={() => { setNotes(notes.map((x) => (x.id === n.id ? { ...x, unread: false } : x))); setOpen(false); navigate(n.page, n.page === 'admin' ? { section: 'governance' } : {}); }}>
              {n.unread && <span className="unread-dot" aria-label="Unread" />}<span className="grow"><b>{n.title}</b><span className="muted small">{n.body}</span></span><span className="muted small">{n.when}</span></button></li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

function ThemeControl({ theme, setTheme }) {
  const next = { system: 'light', light: 'dark', dark: 'system' }[theme];
  const icon = { system: 'monitor', light: 'sun', dark: 'moon' }[theme];
  return <IconBtn icon={icon} label={`Theme: ${theme}. Switch to ${next}`} onClick={() => setTheme(next)} />;
}

function RecordDrawer({ id, onClose, onOpen }) {
  const app = useApp2();
  const r = recordById(id);
  const [showRelated, setShowRelated] = useState(false);
  useEffect(() => setShowRelated(false), [id]);
  const related = RECORDS.filter((x) => x.id !== id && x.application === r.application).slice(0, 5);
  const kind = EVIDENCE_KINDS[r.kind];
  return (
    <Drawer title="Source preview" onClose={onClose}
      footer={<>
        <Btn icon="external" variant="primary" onClick={() => app.toast(`In production this opens ${r.ref} in ${r.source}. Demonstration only.`, 'info')}>Open original source</Btn>
        <Btn icon="layers" onClick={() => setShowRelated(!showRelated)}>{showRelated ? 'Hide related items' : 'View related items'}</Btn>
        <IconBtn icon="bookmark" label="Pin record" onClick={() => app.saveItem({ kind: r.type === 'Document' || r.type === 'Knowledge article' ? 'document' : 'ticket', name: `${r.ref} – ${r.title.slice(0, 48)}`, recordId: r.id })} />
      </>}>
      <div className="rd-head">
        <SourceIcon source={r.source} size={18} />
        <div className="min0"><h3 className="rd-title">{r.title}</h3><p className="muted small">{r.source} · {r.type} · <span className="mono">{r.ref}</span></p></div>
      </div>
      <div className="row-wrap tight"><KindBadge kind={r.kind} /><StatusPill status={r.status} /><DemoTag /></div>
      {r.kind === 'historical' && <Callout tone="info">This resolution is historical and has not been approved as reusable knowledge.</Callout>}
      {r.kind === 'email' && <Callout tone="info">Discussion content. Statements here have not been validated.</Callout>}
      {r.kind === 'devwork' && <Callout tone="info">Development work item. Findings may change as work progresses.</Callout>}
      <div className="excerpt"><span className="eyebrow">Relevant excerpt</span><blockquote>{r.excerpt}</blockquote></div>
      <dl className="rd-dl">
        <dt>Source system</dt><dd>{r.source}</dd>
        <dt>Record type</dt><dd>{r.type}</dd>
        <dt>Reference</dt><dd className="mono">{r.ref}</dd>
        <dt>Last updated</dt><dd>{fmtDate(r.updated)}</dd>
        <dt>Owner group</dt><dd>{r.ownerGroup}</dd>
        <dt>Application</dt><dd>{r.application}</dd>
        <dt>Environment</dt><dd>{r.environment}</dd>
        <dt>Location</dt><dd>{r.location}</dd>
        <dt>Status</dt><dd>{r.status}</dd>
        <dt>Knowledge approval</dt><dd>{r.approval}</dd>
        <dt>Evidence type</dt><dd>{kind.label}</dd>
        {r.rootCause && r.rootCause !== '—' && <><dt>Root cause</dt><dd>{r.rootCause}</dd></>}
        {r.resolution && r.resolution !== '—' && <><dt>Resolution</dt><dd>{r.resolution}</dd></>}
      </dl>
      {showRelated && (
        <div><span className="eyebrow">Related items</span>
          <ul className="rec-list">{related.map((x) => <RecordRow key={x.id} r={x} onOpen={() => onOpen(x.id)} />)}</ul></div>
      )}
    </Drawer>
  );
}

// Local alias so RecordDrawer reads the context the same way as pages do.
function useApp2() { return React.useContext(AppCtx); }

function Profile({ onClose, theme, setTheme }) {
  const app = useApp2();
  return (
    <Drawer title="Profile" onClose={onClose}>
      <div className="profile-head"><span className="avatar lg">{DEMO_USER.initials}</span><div><h3>{DEMO_USER.name}</h3><p className="muted small">{DEMO_USER.email}</p><Badge tone="info" icon="shield">{DEMO_USER.role}</Badge></div></div>
      <Callout tone="info">Demonstration profile. No real personal information is used.</Callout>
      <dl className="rd-dl"><dt>Owner group</dt><dd>{DEMO_USER.group}</dd><dt>Sources you can access</dt><dd>8 of 8</dd><dt>Saved items</dt><dd>{app.saved.length}</dd><dt>Searches this week</dt><dd>46</dd></dl>
      <fieldset className="radio-group"><legend className="label">Theme</legend>
        {['system', 'light', 'dark'].map((t) => <label key={t} className="radio"><input type="radio" name="p-theme" checked={theme === t} onChange={() => setTheme(t)} />{t[0].toUpperCase() + t.slice(1)}</label>)}
      </fieldset>
      <div className="row-wrap"><Btn icon="bookmark" onClick={() => { onClose(); app.navigate('saved'); }}>My saved items</Btn><Btn variant="ghost" onClick={() => app.toast('Sign-out is disabled in the demonstration', 'info')}>Sign out</Btn></div>
    </Drawer>
  );
}

const SCENARIOS = [['normal', 'Normal'], ['insufficient', 'Insufficient evidence'], ['partial', 'Partial results'], ['unauthorized', 'Unauthorized source'], ['unavailable', 'Search service unavailable']];

function Settings({ onClose, theme, setTheme }) {
  const app = useApp2();
  const [density, setDensity] = useState(document.documentElement.dataset.density || 'comfortable');
  const [sc, setSc] = useState(app.scenario);
  return (
    <Modal title="Settings" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={() => { document.documentElement.dataset.density = density; app.setScenario(sc); onClose(); app.toast('Settings saved'); }}>Save</Btn></>}>
      <div className="grid-2">
        <div><label className="label" htmlFor="st-theme">Theme</label><select id="st-theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
        <div><label className="label" htmlFor="st-den">Density</label><select id="st-den" className="input" value={density} onChange={(e) => setDensity(e.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
      </div>
      <div><label className="label" htmlFor="st-sc">Demonstration scenario</label>
        <select id="st-sc" className="input" value={sc} onChange={(e) => setSc(e.target.value)}>{SCENARIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <p className="hint">Changes how the next search responds, to show empty, partial and error states.</p></div>
    </Modal>
  );
}

function Help({ onClose }) {
  const app = useApp2();
  const tour = [
    ['Ask about an incident', 'Submit the preloaded RxCNC query on Search.', () => app.navigate('search')],
    ['Open a citation', 'Select any reference such as A5058563L in the answer.', () => app.runSearch('RxCNC connections work after a server restart but begin timing out again after a few hours.', 'ask', true)],
    ['Compare incidents', 'Similar Issues → View comparison.', () => app.navigate('similar')],
    ['Connect a source', 'Sources → Connect a source and complete all seven steps.', () => app.navigate('sources')],
    ['Review knowledge', 'Administration → Knowledge governance.', () => app.navigate('admin', { section: 'governance' })],
  ];
  return (
    <Modal title="Help" subtitle="Synora prototype with demonstration data" onClose={onClose}>
      <span className="eyebrow">Guided demo</span>
      <ol className="tour">{tour.map(([t, d, go]) => <li key={t}><div className="grow"><b>{t}</b><p className="muted small">{d}</p></div><Btn size="sm" onClick={() => { onClose(); go(); }}>Go</Btn></li>)}</ol>
      <span className="eyebrow">Keyboard</span>
      <dl className="rd-dl"><dt><kbd>Ctrl K</kbd></dt><dd>Search or jump to a page</dd><dt><kbd>/</kbd></dt><dd>Focus the search box</dd><dt><kbd>Enter</kbd></dt><dd>Submit search (Shift+Enter for a new line)</dd><dt><kbd>Esc</kbd></dt><dd>Close dialogs and panels</dd></dl>
    </Modal>
  );
}

function Palette({ onClose }) {
  const app = useApp2();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const items = [
    ...(q.trim() ? [{ label: `Ask Synora: “${q.trim()}”`, icon: 'sparkles', run: () => app.runSearch(q.trim(), 'ask') }, { label: `Search records: “${q.trim()}”`, icon: 'list', run: () => app.runSearch(q.trim(), 'records') }] : []),
    ...NAV.map(([k, l, i]) => ({ label: `Go to ${l}`, icon: i, run: () => app.navigate(k) })),
    ...RECORDS.slice(0, 16).map((r) => ({ label: `${r.ref} · ${r.title}`, icon: 'file', run: () => app.openRecord(r.id) })),
  ].filter((it) => !q.trim() || it.label.toLowerCase().includes(q.toLowerCase()) || it.icon === 'sparkles' || it.icon === 'list');
  const go = (it) => { onClose(); it.run(); };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Global search">
        <div className="pal-input"><Icon name="search" size={18} />
          <label htmlFor="pal-q" className="sr-only">Search or jump to</label>
          <input id="pal-q" autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Ask, search records, or jump to a page…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(items.length - 1, idx + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
              if (e.key === 'Enter' && items[idx]) go(items[idx]);
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul className="pal-list" role="listbox" aria-label="Results">
          {items.slice(0, 12).map((it, i) => (
            <li key={it.label} role="option" aria-selected={i === idx}><button type="button" className={i === idx ? 'active' : ''} onMouseEnter={() => setIdx(i)} onClick={() => go(it)}><Icon name={it.icon} size={16} /><span>{it.label}</span></button></li>
          ))}
          {!items.length && <li className="muted small pal-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
