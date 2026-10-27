import { useApp, Icon, Btn, IconBtn, Badge, Modal, Callout, Menu, StatusPill, SourceIcon, DemoTag, Tabs, Toggle, Meter, fmtNum, Empty } from './ui.jsx';
import { CONNECTOR_TYPES, SYNORA_FIELDS, SOURCE_FIELDS, SYNC_HISTORY, ERROR_LOG, connectorType, OWNER_GROUPS } from './data.js';

const { useState } = React;

const STATUS_ORDER = ['All', 'Connected', 'Syncing', 'Action required', 'Paused', 'Failed', 'Not configured'];

export function SourcesPage() {
  const app = useApp();
  const [filter, setFilter] = useState('All');
  const [q, setQ] = useState('');
  const [wizard, setWizard] = useState(null);
  const list = app.connectors.filter((c) => (filter === 'All' || c.status === filter) && c.name.toLowerCase().includes(q.toLowerCase()));
  const counts = (s) => app.connectors.filter((c) => s === 'All' || c.status === s).length;

  if (app.detailId) return <ConnectorDetail id={app.detailId} onBack={() => app.setDetailId(null)} />;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Sources</h1><p className="muted">Connect a source to make its records searchable. Permissions are synchronized with each source.</p></div>
        <div className="row-wrap tight"><DemoTag>Demonstration connectors</DemoTag><Btn variant="primary" icon="plus" onClick={() => setWizard({})}>Connect a source</Btn></div>
      </header>
      <div className="row-wrap src-toolbar">
        <div className="chip-row">
          {STATUS_ORDER.map((s) => <button key={s} type="button" className={'chip ' + (filter === s ? 'chip-on' : '')} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s} <span className="num muted">{counts(s)}</span></button>)}
        </div>
        <div className="search-mini"><Icon name="search" size={15} /><label htmlFor="src-q" className="sr-only">Search connectors</label><input id="src-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search connectors" /></div>
      </div>
      {!list.length && <Empty icon="plug" title="No connectors in this view" action={<Btn onClick={() => { setFilter('All'); setQ(''); }}>Show all connectors</Btn>} />}
      <div className="conn-grid">
        {list.map((c) => <ConnectorCard key={c.id} c={c} onConfigure={() => (c.status === 'Not configured' ? setWizard({ type: c.type, replaceId: c.id }) : app.setDetailId(c.id))} />)}
      </div>
      {wizard && <Wizard init={wizard} onClose={() => setWizard(null)} />}
    </div>
  );
}

function ConnectorCard({ c, onConfigure }) {
  const app = useApp();
  const t = connectorType(c.type);
  const [confirm, setConfirm] = useState(false);
  const paused = c.status === 'Paused';
  const unconfigured = c.status === 'Not configured';
  return (
    <article className={'conn-card cs-' + c.status.replace(/\s/g, '-').toLowerCase()}>
      <div className="conn-top">
        <SourceIcon source={c.type} size={18} />
        <div className="grow min0">
          <h3 className="conn-name">{c.name}</h3>
          <p className="muted small">{t.desc}</p>
        </div>
        <Menu label={`More actions for ${c.name}`} items={[
          { label: 'View details', icon: 'eye', onClick: () => app.setDetailId(c.id) },
          { label: 'View error log', icon: 'alert', onClick: () => app.setDetailId(c.id, 'errors') },
          { label: 'Copy connector ID', icon: 'copy', onClick: () => app.toast(`Connector ID ${c.id.toUpperCase()}-DEMO copied`) },
          { label: 'Delete connector', icon: 'trash', danger: true, onClick: () => setConfirm(true) },
        ]} />
      </div>
      <div className="conn-status"><StatusPill status={c.status} />{c.issue && <span className="small conn-issue">{c.issue}</span>}</div>
      <dl className="conn-dl">
        <div><dt>Last sync</dt><dd>{c.lastSync}</dd></div>
        <div><dt>Indexed</dt><dd className="num">{fmtNum(c.records)}</dd></div>
        <div><dt>Owner</dt><dd>{c.owner}</dd></div>
        <div><dt>Sync health</dt><dd>{c.health == null ? '—' : <span className="health"><Meter value={c.health} tone={c.health > 90 ? 'good' : c.health > 60 ? 'warn' : 'bad'} /><span className="num">{c.health}%</span></span>}</dd></div>
      </dl>
      <div className="conn-actions">
        <Btn size="sm" icon="settings" onClick={onConfigure}>{unconfigured ? 'Set up' : c.status === 'Action required' ? 'Re-authenticate' : 'Configure'}</Btn>
        {!unconfigured && <Btn size="sm" icon="refresh" disabled={c.status === 'Syncing' || paused || c.status === 'Action required'} onClick={() => app.syncConnector(c.id)}>{c.status === 'Syncing' ? 'Syncing…' : 'Sync'}</Btn>}
        {!unconfigured && c.status !== 'Failed' && <Btn size="sm" variant="ghost" icon={paused ? 'play' : 'pause'} onClick={() => app.togglePause(c.id)}>{paused ? 'Resume' : 'Pause'}</Btn>}
      </div>
      {confirm && <DeleteConfirm c={c} onClose={() => setConfirm(false)} />}
    </article>
  );
}

function DeleteConfirm({ c, onClose, onDone }) {
  const app = useApp();
  const [txt, setTxt] = useState('');
  return (
    <Modal title="Delete connector?" subtitle={c.name} onClose={onClose} size="sm"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="danger" icon="trash" disabled={txt !== 'DELETE'} onClick={() => { app.deleteConnector(c.id); onClose(); onDone && onDone(); }}>Delete connector</Btn></>}>
      <Callout tone="warn">{fmtNum(c.records)} indexed records will be removed from search. The original source is not changed.</Callout>
      <label className="label" htmlFor="del-confirm">Type DELETE to confirm</label>
      <input id="del-confirm" className="input" value={txt} onChange={(e) => setTxt(e.target.value)} autoComplete="off" />
    </Modal>
  );
}

function ConnectorDetail({ id, onBack }) {
  const app = useApp();
  const c = app.connectors.find((x) => x.id === id);
  const [tab, setTab] = useState(app.detailTab || 'overview');
  const [confirm, setConfirm] = useState(false);
  const [edit, setEdit] = useState(false);
  const [cfg, setCfg] = useState({ freq: 'Hourly', incremental: true, perms: true, attachments: true, owner: c ? c.owner : '' });
  if (!c) return <div className="page"><Empty icon="plug" title="Connector removed" action={<Btn onClick={onBack}>Back to Sources</Btn>} /></div>;
  const t = connectorType(c.type);
  const fields = SOURCE_FIELDS[c.type] || SOURCE_FIELDS.default;
  const paused = c.status === 'Paused';
  return (
    <div className="page">
      <button type="button" className="link-btn back" onClick={onBack}><Icon name="left" size={15} />Sources</button>
      <header className="page-head">
        <div className="row tight"><SourceIcon source={c.type} size={22} /><div><h1>{c.name}</h1><p className="muted">{t.name} · {t.desc}</p></div></div>
        <div className="row-wrap tight">
          <Btn icon={paused ? 'play' : 'pause'} onClick={() => app.togglePause(c.id)} disabled={c.status === 'Not configured'}>{paused ? 'Resume' : 'Pause'}</Btn>
          <Btn icon="refresh" onClick={() => app.syncConnector(c.id)} disabled={c.status === 'Syncing' || paused}>Run sync</Btn>
          <Btn icon="edit" onClick={() => { setTab('config'); setEdit(true); }}>Edit configuration</Btn>
          <Btn variant="danger-ghost" icon="trash" onClick={() => setConfirm(true)}>Delete</Btn>
        </div>
      </header>
      {c.issue && <Callout tone={c.status === 'Failed' ? 'bad' : 'warn'} title={c.status === 'Failed' ? 'Sync failure' : 'Expired authentication'}
        action={<Btn size="sm" onClick={() => app.fixConnector(c.id)}>{c.status === 'Failed' ? 'Retry connection' : 'Re-authenticate'}</Btn>}>{c.issue}</Callout>}
      <div className="kpis kpis-sm">
        <Stat label="Connection status" value={<StatusPill status={c.status} />} />
        <Stat label="Last successful sync" value={c.lastSync} />
        <Stat label="Next scheduled sync" value={paused ? 'Paused' : c.next} />
        <Stat label="Indexed records" value={fmtNum(c.records)} />
        <Stat label="Failed records" value={fmtNum(c.failed)} />
        <Stat label="Sync duration" value={c.duration} />
        <Stat label="Permission sync" value={c.status === 'Action required' ? <Badge tone="warn" icon="alert">Behind by 40 h</Badge> : <Badge tone="good" icon="check">Up to date</Badge>} />
      </div>
      <Tabs label="Connector sections" value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Recent activity' }, { value: 'config', label: 'Configuration' }, { value: 'mapping', label: 'Field mappings' },
        { value: 'history', label: 'Sync history' }, { value: 'errors', label: 'Error log', count: ERROR_LOG.length },
      ]} />
      <div className="tab-panel">
        {tab === 'overview' && (
          <ul className="activity">
            {[['refresh', 'Incremental sync completed', '160 records updated', 'Today, 10:05'], ['lock', 'Permissions synchronized', '1,204 access groups', 'Today, 10:06'], ['alert', '3 items skipped', 'See error log', 'Today, 08:11'], ['edit', 'Owner changed', `Set to ${c.owner}`, 'Oct 18']].map(([i, a, b, w]) => (
              <li key={a}><span className="act-ico"><Icon name={i} size={15} /></span><div className="grow"><b>{a}</b><p className="muted small">{b}</p></div><span className="muted small">{w}</span></li>
            ))}
          </ul>
        )}
        {tab === 'config' && (
          <div className="panel narrow">
            <div className="grid-2">
              <div><label className="label" htmlFor="cfg-freq">Sync frequency</label>
                <select id="cfg-freq" className="input" disabled={!edit} value={cfg.freq} onChange={(e) => setCfg({ ...cfg, freq: e.target.value })}>{['Every 15 minutes', 'Hourly', 'Every 6 hours', 'Daily'].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><label className="label" htmlFor="cfg-owner">Owner</label>
                <select id="cfg-owner" className="input" disabled={!edit} value={cfg.owner} onChange={(e) => setCfg({ ...cfg, owner: e.target.value })}>{[c.owner].concat(OWNER_GROUPS.filter((o) => o !== c.owner)).map((x) => <option key={x}>{x}</option>)}</select></div>
            </div>
            <div><span className="label">Authentication</span><p className="mono small">{t.auth[0]} · secret: kv://synora-demo/{c.type}-conn ••••••</p></div>
            <Toggle id="cfg-inc" label="Incremental sync" checked={cfg.incremental} onChange={(v) => edit && setCfg({ ...cfg, incremental: v })} />
            <Toggle id="cfg-perm" label="Permission synchronization" desc="Only show records to people who can open them in the source." checked={cfg.perms} onChange={(v) => edit && setCfg({ ...cfg, perms: v })} />
            <Toggle id="cfg-att" label="Index attachments" checked={cfg.attachments} onChange={(v) => edit && setCfg({ ...cfg, attachments: v })} />
            <div className="row-end">
              {edit ? <><Btn variant="ghost" onClick={() => setEdit(false)}>Cancel</Btn><Btn variant="primary" onClick={() => { setEdit(false); app.updateConnector(c.id, { owner: cfg.owner }); app.toast('Configuration saved'); }}>Save changes</Btn></>
                : <Btn icon="edit" onClick={() => setEdit(true)}>Edit</Btn>}
            </div>
          </div>
        )}
        {tab === 'mapping' && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Source field</th><th>Synora field</th></tr></thead>
            <tbody>{SYNORA_FIELDS.map((f, i) => <tr key={f}><td className="mono">{fields[i]}</td><td>{f}</td></tr>)}</tbody></table></div>
        )}
        {tab === 'history' && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Started</th><th>Type</th><th>Result</th><th className="r">Added</th><th className="r">Updated</th><th className="r">Failed</th><th>Duration</th></tr></thead>
            <tbody>{SYNC_HISTORY.map((h) => <tr key={h.when}><td>{h.when}</td><td>{h.type}</td><td><Badge tone={h.result === 'Succeeded' ? 'good' : 'warn'}>{h.result}</Badge></td><td className="r num">{h.added}</td><td className="r num">{h.updated}</td><td className="r num">{h.failed}</td><td>{h.duration}</td></tr>)}</tbody></table></div>
        )}
        {tab === 'errors' && (
          <ul className="activity">{ERROR_LOG.map((e) => <li key={e.code}><span className="act-ico warn"><Icon name="alert" size={15} /></span><div className="grow"><b className="mono">{e.code}</b><p className="small">{e.msg}</p></div><span className="muted small">{e.when}</span></li>)}</ul>
        )}
      </div>
      {confirm && <DeleteConfirm c={c} onClose={() => setConfirm(false)} onDone={onBack} />}
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="stat"><span className="kpi-label">{label}</span><span className="stat-val">{value}</span></div>;
}

// ---------- Add source wizard ----------
const STEPS = ['Choose source', 'Authentication', 'Select scope', 'Map fields', 'Sync and permissions', 'Test connection', 'Review and activate'];

const SCOPES = {
  sharepoint: [['Site', 'https://contoso-demo.sharepoint.com/sites/LabSystems'], ['Document library', 'Shared Documents'], ['Folder', '/Runbooks'], ['List', 'Known Errors']],
  onedrive: [['Account', 'support-runbooks@demo.synora'], ['Folder', '/Lab Support'], ['File type', '.docx, .pdf, .xlsx']],
  hda: [['REST endpoint', 'https://hda-demo.example/api/v2'], ['Ticket scope', 'Incidents and problems'], ['Status', 'All'], ['Owner group', 'App Support – Lab Systems'], ['Date range', 'Last 24 months']],
  ado: [['Organization', 'synora-demo-org'], ['Project', 'Lab Platforms'], ['Work-item types', 'Bug, User Story, Task'], ['Repository', 'rxcnc-dispatcher'], ['Wiki', 'Lab Platforms.wiki']],
  outlook: [['Mailbox', 'lab-support@demo.synora'], ['Shared mailbox', 'rxcnc-escalations@demo.synora'], ['Folder', 'Inbox/Escalations'], ['Attachment inclusion', 'Text attachments only']],
  teams: [['Team', 'Lab Systems'], ['Channels', 'General, Incidents']],
  confluence: [['Site', 'https://demo.atlassian.example'], ['Spaces', 'INT, LABOPS']],
  sql: [['Server', 'sql-labkpi.demo.local'], ['Database', 'LabKPI'], ['Tables or views', 'vw_incident_summary']],
  rest: [['Base URL', 'https://monitoring-demo.example/api'], ['Resource path', '/alerts'], ['Pagination', 'Cursor']],
  mcp: [['Server URL', 'https://mcp-demo.example/telemetry'], ['Tools', 'list_events, get_device'], ['Resources', 'devices/*']],
};

const AUTH_FIELDS = {
  'Microsoft Entra ID': [['Tenant ID', '00000000-demo-0000-0000-000000000000'], ['Application (client) ID', 'demo-client-7f2c'], ['Client secret', '•••••••••••• (Key Vault reference)']],
  OAuth: [['Authorization URL', 'https://auth-demo.example/oauth/authorize'], ['Client ID', 'synora-demo'], ['Client secret', '••••••••••••']],
  'Managed identity': [['Identity', 'mi-synora-connectors (demo)']],
  'API key': [['Header name', 'X-API-Key'], ['Key', '•••••••••••• (Key Vault reference)']],
  'Service account': [['Username', 'svc-synora-demo'], ['Password', '••••••••••••']],
  'Personal access token': [['Token', '•••••••••••• (expires in 90 days)']],
  'Custom headers': [['Header 1', 'X-Tenant: demo'], ['Header 2', 'Authorization: ••••••••']],
};

function Wizard({ init, onClose }) {
  const app = useApp();
  const [step, setStep] = useState(init.type ? 1 : 0);
  const [type, setType] = useState(init.type || null);
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const t = type ? connectorType(type) : null;
  const [auth, setAuth] = useState(t ? t.auth[0] : null);
  const [scope, setScope] = useState(type ? Object.fromEntries(SCOPES[type]) : {});
  const [mapping, setMapping] = useState({});
  const [sync, setSync] = useState({ freq: 'Hourly', incremental: true, perms: true, deletion: 'Remove from index', attachments: true, types: 'Documents, pages and tickets', retention: 'Match source' });
  const [test, setTest] = useState(null);
  const [name, setName] = useState(t ? `${t.name} – Demo` : '');

  const chooseType = (k) => {
    const nt = connectorType(k);
    setType(k); setAuth(nt.auth[0]); setScope(Object.fromEntries(SCOPES[k])); setMapping({}); setTest(null); setName(`${nt.name} – Demo`);
  };
  const fields = type ? SOURCE_FIELDS[type] || SOURCE_FIELDS.default : [];

  const runTest = () => {
    setTest({ state: 'running' });
    const firstScope = Object.values(scope)[0] || '';
    setTimeout(() => {
      if (!firstScope.trim() || /invalid/i.test(firstScope)) setTest({ state: 'error', msg: `Could not reach "${firstScope || 'empty scope'}". Check the ${SCOPES[type][0][0].toLowerCase()} and that the identity has read access.` });
      else if (!sync.perms) setTest({ state: 'warn', msg: 'Connected, but permission synchronization is off. Every Synora user could see every record from this source.' });
      else setTest({ state: 'ok', msg: `Connected. ${fmtNum(1200 + type.length * 517)} records found in scope. Permissions readable.` });
    }, 1100);
  };

  const canNext = [!!type, !!auth, Object.values(scope).some((v) => v.trim()), true, true, test && (test.state === 'ok' || test.state === 'warn'), true][step];

  const activate = () => {
    app.addConnector({ type, name: name || `${t.name} – Demo`, owner: 'Platform Engineering', replaceId: init.replaceId });
    onClose();
  };

  const cats = ['All'].concat([...new Set(CONNECTOR_TYPES.map((x) => x.cat))]);
  return (
    <Modal title="Connect a source" subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} onClose={onClose} size="xl"
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <span className="grow" />
        {step > 0 && <Btn icon="left" onClick={() => setStep(step - 1)}>Back</Btn>}
        {step < STEPS.length - 1 ? <Btn variant="primary" iconRight="right" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Btn>
          : <Btn variant="primary" icon="zap" onClick={activate}>Activate connector</Btn>}
      </>}>
      <ol className="stepper" aria-label="Wizard progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="st-dot">{i < step ? <Icon name="check" size={12} /> : i + 1}</span><span className="st-label">{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <div className="row-wrap">
            <div className="chip-row">{cats.map((c) => <button key={c} type="button" className={'chip ' + (cat === c ? 'chip-on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>
            <div className="search-mini"><Icon name="search" size={15} /><label htmlFor="wz-q" className="sr-only">Search connector types</label><input id="wz-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search connector types" /></div>
          </div>
          <div className="type-grid">
            {CONNECTOR_TYPES.filter((x) => (cat === 'All' || x.cat === cat) && x.name.toLowerCase().includes(q.toLowerCase())).map((x) => (
              <button key={x.key} type="button" className={'type-card ' + (type === x.key ? 'sel' : '')} aria-pressed={type === x.key} onClick={() => chooseType(x.key)}>
                <SourceIcon source={x.key} size={17} /><span><b>{x.name}</b><span className="muted small">{x.desc}</span></span>
                {type === x.key && <Icon name="check" size={16} className="type-check" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && t && (
        <div className="wz-grid">
          <fieldset className="radio-cards"><legend className="label">Authentication method for {t.name}</legend>
            {t.auth.map((a) => (
              <label key={a} className={'radio-card ' + (auth === a ? 'sel' : '')}>
                <input type="radio" name="auth" checked={auth === a} onChange={() => setAuth(a)} />
                <span><b>{a}</b><span className="muted small">{{ 'Microsoft Entra ID': 'Recommended for Microsoft 365 sources', 'Managed identity': 'No secret to rotate', OAuth: 'Delegated or app consent', 'API key': 'Stored as a Key Vault reference', 'Service account': 'Dedicated non-personal account', 'Personal access token': 'Scoped token with expiry', 'Custom headers': 'For bespoke gateways' }[a]}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="panel-inner">
            {AUTH_FIELDS[auth].map(([l, v]) => (
              <div key={l}><label className="label" htmlFor={'af-' + l}>{l}</label><input id={'af-' + l} className="input mono" readOnly value={v} /></div>
            ))}
            <p className="hint"><Icon name="lock" size={13} /> Demonstration values only. Real secrets are stored in Key Vault and never shown.</p>
          </div>
        </div>
      )}

      {step === 2 && t && (
        <div className="panel-inner">
          <p className="muted small">Choose what Synora should index from {t.name}. Type “invalid” in the first field to see a failed connection test.</p>
          <div className="grid-2">
            {SCOPES[type].map(([l]) => (
              <div key={l}><label className="label" htmlFor={'sc-' + l}>{l}</label>
                <input id={'sc-' + l} className="input" value={scope[l] || ''} onChange={(e) => { setScope({ ...scope, [l]: e.target.value }); setTest(null); }} /></div>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="table-wrap">
          <table className="table map-table">
            <thead><tr><th>Source field</th><th aria-hidden="true" /><th>Synora field</th></tr></thead>
            <tbody>
              {SYNORA_FIELDS.map((f, i) => (
                <tr key={f}>
                  <td><select className="input input-sm mono" aria-label={`Source field for ${f}`} value={mapping[f] || fields[i]} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                    {fields.concat(['(not mapped)']).map((x) => <option key={x}>{x}</option>)}</select></td>
                  <td aria-hidden="true"><Icon name="arrow" size={15} /></td>
                  <td>{f}{['Title', 'Content', 'Source ID'].includes(f) && <Badge tone="info">Required</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {step === 4 && (
        <div className="wz-grid">
          <div className="panel-inner">
            <div><label className="label" htmlFor="sy-freq">Sync frequency</label>
              <select id="sy-freq" className="input" value={sync.freq} onChange={(e) => setSync({ ...sync, freq: e.target.value })}>{['Every 15 minutes', 'Hourly', 'Every 6 hours', 'Daily'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className="label" htmlFor="sy-del">Deletion handling</label>
              <select id="sy-del" className="input" value={sync.deletion} onChange={(e) => setSync({ ...sync, deletion: e.target.value })}>{['Remove from index', 'Keep as archived', 'Flag for review'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className="label" htmlFor="sy-types">Content types</label>
              <select id="sy-types" className="input" value={sync.types} onChange={(e) => setSync({ ...sync, types: e.target.value })}>{['Documents, pages and tickets', 'Tickets only', 'Documents only'].map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><label className="label" htmlFor="sy-ret">Retention</label>
              <select id="sy-ret" className="input" value={sync.retention} onChange={(e) => setSync({ ...sync, retention: e.target.value })}>{['Match source', '1 year', '3 years', '7 years'].map((x) => <option key={x}>{x}</option>)}</select></div>
          </div>
          <div className="panel-inner">
            <Toggle id="sy-inc" label="Incremental sync" desc="Only fetch changes after the first full sync." checked={sync.incremental} onChange={(v) => setSync({ ...sync, incremental: v })} />
            <Toggle id="sy-perm" label="Permission synchronization" desc="Recommended. Turn off to see a warning at the test step." checked={sync.perms} onChange={(v) => { setSync({ ...sync, perms: v }); setTest(null); }} />
            <Toggle id="sy-att" label="Attachment indexing" desc="Text-based attachments up to 50 MB." checked={sync.attachments} onChange={(v) => setSync({ ...sync, attachments: v })} />
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="test-panel">
          <Btn variant="primary" icon="zap" onClick={runTest} disabled={test && test.state === 'running'}>{test && test.state === 'running' ? 'Testing connection…' : test ? 'Run test again' : 'Test connection'}</Btn>
          {!test && <p className="muted small">The test checks reachability, authentication, scope and permissions. No data is copied.</p>}
          {test && test.state === 'running' && <ol className="retrieve"><li className="done"><span className="r-dot"><Icon name="check" size={12} /></span>Resolving endpoint</li><li className="now"><span className="r-dot" />Authenticating with {auth}</li><li><span className="r-dot" />Reading scope</li></ol>}
          {test && test.state === 'ok' && <Callout tone="good" title="Connection test successful">{test.msg}</Callout>}
          {test && test.state === 'warn' && <Callout tone="warn" title="Connected with a warning">{test.msg}</Callout>}
          {test && test.state === 'error' && <Callout tone="bad" title="Connection test failed" action={<Btn size="sm" onClick={() => setStep(2)}>Edit scope</Btn>}>{test.msg}</Callout>}
        </div>
      )}

      {step === 6 && t && (
        <div className="review">
          <div><label className="label" htmlFor="wz-name">Connector name</label><input id="wz-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <dl className="review-dl">
            <dt>Source</dt><dd>{t.name}</dd>
            <dt>Authentication</dt><dd>{auth}</dd>
            {Object.entries(scope).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v || '—'}</dd></React.Fragment>)}
            <dt>Field mappings</dt><dd>{SYNORA_FIELDS.length} fields mapped</dd>
            <dt>Sync</dt><dd>{sync.freq}{sync.incremental ? ', incremental' : ''}</dd>
            <dt>Permissions</dt><dd>{sync.perms ? 'Synchronized from source' : 'Not synchronized'}</dd>
            <dt>Deletion</dt><dd>{sync.deletion}</dd>
            <dt>Attachments</dt><dd>{sync.attachments ? 'Indexed' : 'Skipped'}</dd>
            <dt>Retention</dt><dd>{sync.retention}</dd>
            <dt>Connection test</dt><dd>{test && test.state === 'ok' ? 'Passed' : 'Passed with warning'}</dd>
          </dl>
          <Callout tone="info">This is a demonstration connector. Activating it adds it to Sources and simulates a first sync.</Callout>
        </div>
      )}
    </Modal>
  );
}
