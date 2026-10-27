import { useApp, Icon, Btn, Badge, Modal, Callout, StatusPill, Toggle, DemoTag, KindBadge, fmtNum } from './ui.jsx';
import { USERS, ROLES, AUDIT, KNOWLEDGE_CANDIDATE, SYSTEM_HEALTH, OWNER_GROUPS, recordById, connectorType } from './data.js';
import { BarList } from './charts.jsx';

const { useState } = React;

const SECTIONS = [
  ['users', 'Users and roles', 'users'], ['ownership', 'Connector ownership', 'plug'], ['ai', 'AI configuration', 'sparkles'],
  ['search', 'Search configuration', 'search'], ['governance', 'Knowledge governance', 'book'], ['audit', 'Audit activity', 'list'],
  ['retention', 'Data retention', 'clock'], ['security', 'Security settings', 'lock'], ['usage', 'Usage analytics', 'chart'], ['health', 'System health', 'activity'],
];

export function AdminPage() {
  const app = useApp();
  const sec = app.adminSection;
  const cur = SECTIONS.find((s) => s[0] === sec) || SECTIONS[0];
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Administration</h1><p className="muted">Roles, providers, governance and platform health.</p></div>
        <DemoTag />
      </header>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Administration sections">
          <label htmlFor="admin-sel" className="sr-only">Section</label>
          <select id="admin-sel" className="input admin-sel" value={cur[0]} onChange={(e) => app.setAdminSection(e.target.value)}>
            {SECTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <ul>
            {SECTIONS.map(([k, l, i]) => (
              <li key={k}><button type="button" className={'admin-link ' + (cur[0] === k ? 'active' : '')} aria-current={cur[0] === k ? 'page' : undefined} onClick={() => app.setAdminSection(k)}><Icon name={i} size={16} />{l}</button></li>
            ))}
          </ul>
        </nav>
        <section className="admin-body" aria-labelledby="admin-h">
          <h2 id="admin-h" className="h2">{cur[1]}</h2>
          {cur[0] === 'users' && <Users />}
          {cur[0] === 'ownership' && <Ownership />}
          {cur[0] === 'ai' && <AIConfig />}
          {cur[0] === 'search' && <SearchConfig />}
          {cur[0] === 'governance' && <Governance />}
          {cur[0] === 'audit' && <Audit />}
          {cur[0] === 'retention' && <Retention />}
          {cur[0] === 'security' && <Security />}
          {cur[0] === 'usage' && <Usage />}
          {cur[0] === 'health' && <Health />}
        </section>
      </div>
    </div>
  );
}

function Users() {
  const app = useApp();
  const [users, setUsers] = useState(USERS);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Search User');
  const perms = { 'Search User': 'Search and save', 'Support Engineer': 'Search, investigate, create summaries', 'Connector Owner': 'Manage assigned connectors', 'Knowledge Manager': 'Review and approve knowledge', Administrator: 'Full configuration', Auditor: 'Read-only audit and usage' };
  return (
    <>
      <div className="row-between"><p className="muted small">{users.length} users · roles control what each person can see and change.</p><Btn size="sm" variant="primary" icon="plus" onClick={() => setInvite(true)}>Invite user</Btn></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Owner group</th><th>Role</th><th>Last active</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><b>{u.name}</b><br /><span className="muted small">{u.email}</span></td>
            <td>{u.group}</td>
            <td><select className="input input-sm" aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => { setUsers(users.map((x) => x.id === u.id ? { ...x, role: e.target.value } : x)); app.toast(`${u.name} is now ${e.target.value}`); }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></td>
            <td>{u.last}</td>
          </tr>))}
        </tbody></table></div>
      <div className="role-grid">{ROLES.map((r) => <div key={r} className="role-card"><b>{r}</b><span className="muted small">{perms[r]}</span></div>)}</div>
      {invite && (
        <Modal title="Invite user" onClose={() => setInvite(false)} size="sm"
          footer={<><Btn variant="ghost" onClick={() => setInvite(false)}>Cancel</Btn><Btn variant="primary" disabled={!/@/.test(email)} onClick={() => { setUsers(users.concat({ id: 'u' + Date.now(), name: email.split('@')[0], email, role, group: 'Unassigned', last: 'Invited' })); setInvite(false); setEmail(''); app.toast('Invitation recorded (demonstration – no email sent)'); }}>Invite</Btn></>}>
          <label className="label" htmlFor="inv-email">Work email</label><input id="inv-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@demo.synora" />
          <label className="label" htmlFor="inv-role">Role</label><select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        </Modal>
      )}
    </>
  );
}

function Ownership() {
  const app = useApp();
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Connector</th><th>Status</th><th>Owner group</th></tr></thead>
      <tbody>{app.connectors.map((c) => (
        <tr key={c.id}><td><b>{c.name}</b><br /><span className="muted small">{connectorType(c.type).name}</span></td><td><StatusPill status={c.status} /></td>
          <td><select className="input input-sm" aria-label={`Owner for ${c.name}`} value={c.owner} onChange={(e) => { app.updateConnector(c.id, { owner: e.target.value }); app.toast('Owner updated'); }}>
            {[...new Set([c.owner, 'Knowledge Management'].concat(OWNER_GROUPS))].map((o) => <option key={o}>{o}</option>)}</select></td></tr>))}
      </tbody></table></div>
  );
}

const PROVIDERS = {
  OpenAI: { model: 'gpt-5.1', endpoint: 'https://api.openai.com/v1', ver: '—' },
  'Azure OpenAI': { model: 'synora-gpt-prod (deployment)', endpoint: 'https://synora-demo.openai.azure.com', ver: '2025-04-01-preview' },
  Anthropic: { model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com', ver: '2023-06-01' },
  'Microsoft-supported provider': { model: 'Azure AI Foundry deployment', endpoint: 'https://synora-demo.services.ai.azure.com', ver: '2025-05-01' },
  Google: { model: 'gemini-2.5-pro', endpoint: 'https://generativelanguage.googleapis.com', ver: 'v1' },
  'Custom compatible provider': { model: 'custom-model', endpoint: 'https://llm-gateway.demo.internal/v1', ver: 'v1' },
};

function AIConfig() {
  const app = useApp();
  const [c, setC] = useState({ provider: 'Azure OpenAI', ...PROVIDERS['Azure OpenAI'], secret: 'kv://synora-demo-kv/secrets/aoai-key', temp: 0.2, maxLen: 900, retrieval: 12, cite: true, conf: 0.6, stream: true, fallback: 'Anthropic' });
  const [dirty, setDirty] = useState(false);
  const set = (p) => { setC({ ...c, ...p }); setDirty(true); };
  return (
    <div className="panel">
      <Callout tone="info">Codex may assist with development and code review, while the configured model provider supplies the production reasoning capability.</Callout>
      <div className="grid-2">
        <div><label className="label" htmlFor="ai-prov">Provider</label><select id="ai-prov" className="input" value={c.provider} onChange={(e) => set({ provider: e.target.value, ...PROVIDERS[e.target.value] })}>{Object.keys(PROVIDERS).map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label className="label" htmlFor="ai-model">Deployment or model</label><input id="ai-model" className="input" value={c.model} onChange={(e) => set({ model: e.target.value })} /></div>
        <div><label className="label" htmlFor="ai-ep">Endpoint</label><input id="ai-ep" className="input mono" value={c.endpoint} onChange={(e) => set({ endpoint: e.target.value })} /></div>
        <div><label className="label" htmlFor="ai-ver">API version</label><input id="ai-ver" className="input mono" value={c.ver} onChange={(e) => set({ ver: e.target.value })} /></div>
        <div className="span-2"><label className="label" htmlFor="ai-secret">Secret reference</label>
          <div className="row tight"><Icon name="key" size={16} /><input id="ai-secret" className="input mono" value={c.secret} onChange={(e) => set({ secret: e.target.value })} /></div>
          <p className="hint">Key Vault reference only. Synora never displays or stores the key itself.</p></div>
        <div><label className="label" htmlFor="ai-temp">Temperature <b className="num">{c.temp.toFixed(1)}</b></label><input id="ai-temp" type="range" min="0" max="1" step="0.1" value={c.temp} onChange={(e) => set({ temp: +e.target.value })} /></div>
        <div><label className="label" htmlFor="ai-conf">Confidence threshold <b className="num">{c.conf.toFixed(2)}</b></label><input id="ai-conf" type="range" min="0.3" max="0.9" step="0.05" value={c.conf} onChange={(e) => set({ conf: +e.target.value })} /></div>
        <div><label className="label" htmlFor="ai-len">Maximum answer length (tokens)</label><input id="ai-len" type="number" className="input" value={c.maxLen} onChange={(e) => set({ maxLen: +e.target.value })} /></div>
        <div><label className="label" htmlFor="ai-ret">Retrieval limit (passages)</label><input id="ai-ret" type="number" className="input" value={c.retrieval} onChange={(e) => set({ retrieval: +e.target.value })} /></div>
        <div><label className="label" htmlFor="ai-fb">Fallback provider</label><select id="ai-fb" className="input" value={c.fallback} onChange={(e) => set({ fallback: e.target.value })}>{['None'].concat(Object.keys(PROVIDERS).filter((p) => p !== c.provider)).map((p) => <option key={p}>{p}</option>)}</select></div>
      </div>
      <Toggle id="ai-cite" label="Require citations" desc="Answers without a supporting source are not shown." checked={c.cite} onChange={(v) => set({ cite: v })} />
      <Toggle id="ai-stream" label="Streaming enabled" checked={c.stream} onChange={(v) => set({ stream: v })} />
      {!c.cite && <Callout tone="warn">Without required citations, answers may include unsupported claims.</Callout>}
      <div className="row-end">
        <Btn icon="zap" onClick={() => app.toast(`Test prompt answered by ${c.provider} in 2.1 s (simulated)`, 'good')}>Test provider</Btn>
        <Btn variant="primary" disabled={!dirty} onClick={() => { setDirty(false); app.toast('AI configuration saved and recorded in the audit log'); }}>Save</Btn>
      </div>
    </div>
  );
}

function SearchConfig() {
  const app = useApp();
  const [s, setS] = useState({ hybrid: true, rerank: true, boostApproved: true, decay: 18, minSim: 60, synonyms: 'timeout, timed out, time out\nprint queue, spooler\norder launch, OL' });
  return (
    <div className="panel">
      <Toggle id="sc-h" label="Hybrid retrieval" desc="Combine keyword and semantic search." checked={s.hybrid} onChange={(v) => setS({ ...s, hybrid: v })} />
      <Toggle id="sc-r" label="Re-rank results" checked={s.rerank} onChange={(v) => setS({ ...s, rerank: v })} />
      <Toggle id="sc-b" label="Boost approved knowledge" desc="Approved articles rank above historical tickets with the same relevance." checked={s.boostApproved} onChange={(v) => setS({ ...s, boostApproved: v })} />
      <div className="grid-2">
        <div><label className="label" htmlFor="sc-d">Freshness decay (months) <b className="num">{s.decay}</b></label><input id="sc-d" type="range" min="3" max="36" value={s.decay} onChange={(e) => setS({ ...s, decay: +e.target.value })} /></div>
        <div><label className="label" htmlFor="sc-m">Default similarity threshold <b className="num">{s.minSim}%</b></label><input id="sc-m" type="range" min="40" max="95" step="5" value={s.minSim} onChange={(e) => setS({ ...s, minSim: +e.target.value })} /></div>
      </div>
      <label className="label" htmlFor="sc-syn">Synonyms (one group per line)</label>
      <textarea id="sc-syn" className="input mono" rows={4} value={s.synonyms} onChange={(e) => setS({ ...s, synonyms: e.target.value })} />
      <div className="row-end"><Btn variant="primary" onClick={() => app.toast('Search configuration saved')}>Save</Btn></div>
    </div>
  );
}

const FLOW = ['Draft', 'Review', 'Approved', 'Published', 'Archived'];

function Governance() {
  const app = useApp();
  const k = KNOWLEDGE_CANDIDATE;
  const [status, setStatus] = useState('Review');
  const [checks, setChecks] = useState({});
  const [comment, setComment] = useState('');
  const [modal, setModal] = useState(null);
  const allChecked = k.checklist.every((c) => checks[c]);
  const stage = status === 'Changes requested' ? 'Draft' : status === 'Rejected' ? null : status;
  const decide = (s, msg) => { setStatus(s); setModal(null); app.toast(msg); };
  return (
    <div className="gov">
      <ol className="flow" aria-label="Knowledge workflow">
        {FLOW.map((f, i) => <li key={f} className={stage === f ? 'now' : stage && FLOW.indexOf(stage) > i ? 'done' : ''}><span>{f}</span></li>)}
      </ol>
      <article className="panel">
        <div className="row-between">
          <div className="row-wrap tight"><span className="mono">{k.id}</span><StatusPill status={status} /><KindBadge kind="ai" /></div>
          <span className="muted small">Reviewer: {k.reviewer}</span>
        </div>
        <h3 className="h3">{k.title}</h3>
        <Callout tone="info">Candidate generated from historical records. It is not approved and will not appear as approved knowledge until a Knowledge Manager approves it.</Callout>
        <div className="gov-grid">
          <div>
            <span className="eyebrow">Draft resolution</span>
            <pre className="summary-pre">{k.draft}</pre>
            <span className="eyebrow">Supporting sources</span>
            <ul className="mini-list">{k.sources.map(recordById).map((r) => <li key={r.id}><button type="button" className="link-btn" onClick={() => app.openRecord(r.id)}><span className="mono">{r.ref}</span> {r.title}</button><KindBadge kind={r.kind} /></li>)}</ul>
          </div>
          <div>
            <span className="eyebrow">Validation checklist</span>
            <ul className="check-list">{k.checklist.map((c) => <li key={c}><label className="check"><input type="checkbox" checked={!!checks[c]} disabled={status !== 'Review'} onChange={() => setChecks({ ...checks, [c]: !checks[c] })} />{c}</label></li>)}</ul>
            <label className="label" htmlFor="gov-c">Reviewer comment</label>
            <textarea id="gov-c" className="input" rows={3} value={comment} disabled={status !== 'Review'} onChange={(e) => setComment(e.target.value)} placeholder="Required for changes or rejection" />
          </div>
        </div>
        {status === 'Review' ? (
          <div className="row-end">
            <Btn variant="danger-ghost" disabled={!comment.trim()} onClick={() => setModal('reject')}>Reject</Btn>
            <Btn disabled={!comment.trim()} onClick={() => decide('Changes requested', 'Changes requested from the author')}>Request changes</Btn>
            <Btn variant="primary" icon="check" disabled={!allChecked} onClick={() => setModal('approve')}>Approve</Btn>
          </div>
        ) : (
          <div className="row-end">
            {status === 'Approved' && <Btn variant="primary" onClick={() => decide('Published', 'Published to the knowledge base')}>Publish</Btn>}
            {status === 'Published' && <Btn onClick={() => decide('Archived', 'Archived')}>Archive</Btn>}
            <Btn variant="ghost" icon="refresh" onClick={() => { setStatus('Review'); setChecks({}); setComment(''); }}>Reset demo</Btn>
          </div>
        )}
        {status === 'Review' && !allChecked && <p className="hint right">Complete every validation check to approve.</p>}
      </article>
      {modal === 'approve' && (
        <Modal title="Approve knowledge candidate?" onClose={() => setModal(null)} size="sm"
          footer={<><Btn variant="ghost" onClick={() => setModal(null)}>Cancel</Btn><Btn variant="primary" onClick={() => decide('Approved', 'Candidate approved. Publish it to make it searchable as approved knowledge.')}>Approve</Btn></>}>
          <p>You confirm the steps were validated and every claim is supported by a cited source. This is recorded in the audit log.</p>
        </Modal>
      )}
      {modal === 'reject' && (
        <Modal title="Reject knowledge candidate?" onClose={() => setModal(null)} size="sm"
          footer={<><Btn variant="ghost" onClick={() => setModal(null)}>Cancel</Btn><Btn variant="danger" onClick={() => decide('Rejected', 'Candidate rejected')}>Reject</Btn></>}>
          <p>The candidate will be closed. Your comment is sent to the author.</p>
        </Modal>
      )}
    </div>
  );
}

function Audit() {
  const app = useApp();
  const [cat, setCat] = useState('All');
  const cats = ['All', ...new Set(AUDIT.map((a) => a.cat))];
  return (
    <>
      <div className="row-between">
        <div className="chip-row">{cats.map((c) => <button key={c} type="button" className={'chip ' + (cat === c ? 'chip-on' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>
        <Btn size="sm" icon="download" onClick={() => app.toast('Audit export prepared (demonstration – no file is created)')}>Export</Btn>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Category</th></tr></thead>
        <tbody>{AUDIT.filter((a) => cat === 'All' || a.cat === cat).map((a, i) => <tr key={i}><td>{a.when}</td><td>{a.who}</td><td>{a.action}</td><td>{a.target}</td><td><Badge>{a.cat}</Badge></td></tr>)}</tbody>
      </table></div>
    </>
  );
}

function Retention() {
  const app = useApp();
  const [r, setR] = useState({ index: 'Match source', answers: '90 days', history: '30 days', audit: '400 days', feedback: '1 year' });
  const rows = [['index', 'Indexed content', ['Match source', '1 year', '3 years', '7 years']], ['answers', 'Saved AI answers', ['30 days', '90 days', '1 year']], ['history', 'Search history', ['7 days', '30 days', '90 days']], ['audit', 'Audit log', ['400 days', '3 years', '7 years']], ['feedback', 'Answer feedback', ['90 days', '1 year']]];
  return (
    <div className="panel narrow">
      {rows.map(([k, l, o]) => <div key={k} className="row-between"><label htmlFor={'rt-' + k}>{l}</label><select id={'rt-' + k} className="input input-sm w-auto" value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })}>{o.map((x) => <option key={x}>{x}</option>)}</select></div>)}
      <Callout tone="info">Deleted source records are removed from the index at the next sync.</Callout>
      <div className="row-end"><Btn variant="primary" onClick={() => app.toast('Retention settings saved')}>Save</Btn></div>
    </div>
  );
}

function Security() {
  const app = useApp();
  const [s, setS] = useState({ sso: true, mfa: true, pii: true, perm: true, export: false, ip: false });
  return (
    <div className="panel narrow">
      <Toggle id="se-sso" label="Single sign-on with Microsoft Entra ID" checked={s.sso} onChange={(v) => setS({ ...s, sso: v })} />
      <Toggle id="se-mfa" label="Require MFA" checked={s.mfa} onChange={(v) => setS({ ...s, mfa: v })} />
      <Toggle id="se-pii" label="Mask personal data in answers" desc="Emails, phone numbers and names in excerpts are masked." checked={s.pii} onChange={(v) => setS({ ...s, pii: v })} />
      <Toggle id="se-perm" label="Enforce source permissions" desc="Results are filtered to what each user can open in the source." checked={s.perm} onChange={(v) => setS({ ...s, perm: v })} />
      {!s.perm && <Callout tone="bad">Turning this off exposes restricted records to every user.</Callout>}
      <Toggle id="se-exp" label="Allow export for Search Users" checked={s.export} onChange={(v) => setS({ ...s, export: v })} />
      <Toggle id="se-ip" label="Restrict access to corporate network" checked={s.ip} onChange={(v) => setS({ ...s, ip: v })} />
      <div className="row-end"><Btn variant="primary" onClick={() => app.toast('Security settings saved')}>Save</Btn></div>
    </div>
  );
}

function Usage() {
  return (
    <>
      <div className="kpis kpis-sm">
        {[['Searches (30 days)', '18,420'], ['Answers marked helpful', '81%'], ['Median time to answer', '3.1 s'], ['Active users', '742']].map(([l, v]) => <div key={l} className="stat"><span className="kpi-label">{l}</span><span className="kpi-val num">{v}</span></div>)}
      </div>
      <div className="card"><header className="card-head"><h2>Searches by team</h2><span className="muted small">Last 30 days · demonstration data</span></header>
        <BarList unit="searches" data={[{ label: 'App Support – Lab Systems', value: 6210 }, { label: 'Service Desk L1', value: 5120 }, { label: 'App Support – Order Flow', value: 3380 }, { label: 'Integration Team', value: 2040 }, { label: 'Platform Engineering', value: 1670 }]} />
      </div>
    </>
  );
}

function Health() {
  const app = useApp();
  return (
    <>
      <ul className="health-list">{SYSTEM_HEALTH.map((h) => <li key={h.name}><span className={'health-dot hd-' + (h.status === 'Operational' ? 'good' : 'warn')} aria-hidden="true" /><b className="grow">{h.name}</b><span className="muted small">{h.latency}</span><StatusPill status={h.status} /></li>)}</ul>
      <div className="row-end"><Btn icon="refresh" onClick={() => app.toast('Health checks refreshed')}>Refresh</Btn></div>
    </>
  );
}
