import { useApp, Icon, Btn, IconBtn, Badge, Modal, Menu, Empty, Tabs, DemoTag } from './ui.jsx';
import { recordById } from './data.js';

const { useState } = React;

const KINDS = [
  { value: 'search', label: 'Saved searches', icon: 'search' },
  { value: 'answer', label: 'Saved AI answers', icon: 'sparkles' },
  { value: 'ticket', label: 'Pinned tickets', icon: 'ticket' },
  { value: 'document', label: 'Pinned documents', icon: 'file' },
  { value: 'collections', label: 'Investigation collections', icon: 'folder' },
];

export function SavedPage() {
  const app = useApp();
  const [tab, setTab] = useState('search');
  const [sel, setSel] = useState([]);
  const [groupOpen, setGroupOpen] = useState(false);
  const items = app.saved.filter((s) => s.kind === tab);

  const openItem = (s) => {
    if (s.query) app.runSearch(s.query, s.kind === 'answer' ? 'ask' : 'ask', true);
    else if (s.recordId) app.openRecord(s.recordId);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Saved</h1><p className="muted">Searches, answers and records you want to come back to.</p></div>
        <DemoTag />
      </header>
      <Tabs label="Saved item types" value={tab} onChange={(v) => { setTab(v); setSel([]); }}
        tabs={KINDS.map((k) => ({ ...k, count: k.value === 'collections' ? app.collections.length : app.saved.filter((s) => s.kind === k.value).length }))} />
      <div className="tab-panel">
        {tab !== 'collections' && (
          <>
            {sel.length > 0 && (
              <div className="bulk-bar" role="region" aria-label="Selection actions">
                <b>{sel.length} selected</b>
                <Btn size="sm" icon="folder" onClick={() => setGroupOpen(true)}>Add to collection</Btn>
                <Btn size="sm" variant="danger-ghost" icon="trash" onClick={() => { app.removeSaved(sel); setSel([]); }}>Remove</Btn>
                <button type="button" className="link-btn" onClick={() => setSel([])}>Clear selection</button>
              </div>
            )}
            {!items.length && <Empty icon="bookmark" title="Nothing saved here yet">Use Save on an answer, or Pin on a ticket or document.</Empty>}
            <ul className="saved-list">
              {items.map((s) => <SavedRow key={s.id} s={s} checked={sel.includes(s.id)} onCheck={() => setSel(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : sel.concat(s.id))} onOpen={() => openItem(s)} />)}
            </ul>
          </>
        )}
        {tab === 'collections' && <Collections onOpen={openItem} />}
      </div>
      {groupOpen && <GroupModal ids={sel} onClose={() => setGroupOpen(false)} onDone={() => { setSel([]); setGroupOpen(false); }} />}
    </div>
  );
}

function SavedRow({ s, checked, onCheck, onOpen }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState('');
  const col = app.collections.find((c) => c.id === s.collection);
  const rec = s.recordId ? recordById(s.recordId) : null;
  return (
    <li className="saved-row">
      <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${s.name}`} />
      <div className="grow min0">
        {editing ? (
          <form className="row tight" onSubmit={(e) => { e.preventDefault(); app.updateSaved(s.id, { name: name.trim() || s.name }); setEditing(false); app.toast('Renamed'); }}>
            <label htmlFor={'rn-' + s.id} className="sr-only">Name</label>
            <input id={'rn-' + s.id} className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Btn size="sm" variant="primary" type="submit">Save</Btn><Btn size="sm" variant="ghost" onClick={() => { setName(s.name); setEditing(false); }}>Cancel</Btn>
          </form>
        ) : (
          <button type="button" className="saved-name" onClick={onOpen}>{s.name}</button>
        )}
        <p className="muted small">{s.query ? `“${s.query}”` : rec ? `${rec.ref} · ${rec.source}` : ''} · Saved {s.when}{col ? ` · In ${col.name}` : ''}</p>
        <div className="chip-row tight">
          {s.tags.map((t) => <span key={t} className="fchip sm">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => app.updateSaved(s.id, { tags: s.tags.filter((x) => x !== t) })}><Icon name="x" size={12} /></button></span>)}
          {tagging ? (
            <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) app.updateSaved(s.id, { tags: s.tags.concat(tag.trim()) }); setTag(''); setTagging(false); }}>
              <label htmlFor={'tg-' + s.id} className="sr-only">New tag</label>
              <input id={'tg-' + s.id} className="input input-xs" value={tag} onChange={(e) => setTag(e.target.value)} onBlur={() => setTagging(false)} autoFocus placeholder="tag" />
            </form>
          ) : <button type="button" className="add-tag" onClick={() => setTagging(true)}><Icon name="tag" size={12} />Add tag</button>}
        </div>
      </div>
      <Btn size="sm" icon={s.query ? 'search' : 'eye'} onClick={onOpen}>Open</Btn>
      <Menu label={`Actions for ${s.name}`} items={[
        { label: 'Rename', icon: 'edit', onClick: () => setEditing(true) },
        { label: 'Add tag', icon: 'tag', onClick: () => setTagging(true) },
        { label: 'Remove', icon: 'trash', danger: true, onClick: () => app.removeSaved([s.id]) },
      ]} />
    </li>
  );
}

function GroupModal({ ids, onClose, onDone }) {
  const app = useApp();
  const [target, setTarget] = useState(app.collections[0] ? app.collections[0].id : 'new');
  const [name, setName] = useState('');
  return (
    <Modal title="Add to collection" subtitle={`${ids.length} item${ids.length > 1 ? 's' : ''}`} onClose={onClose} size="sm"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={target === 'new' && !name.trim()} onClick={() => { app.groupSaved(ids, target, name.trim()); onDone(); }}>Add</Btn></>}>
      <fieldset className="radio-group"><legend className="label">Collection</legend>
        {app.collections.map((c) => <label key={c.id} className="radio"><input type="radio" name="col" checked={target === c.id} onChange={() => setTarget(c.id)} />{c.name}</label>)}
        <label className="radio"><input type="radio" name="col" checked={target === 'new'} onChange={() => setTarget('new')} />New collection</label>
      </fieldset>
      {target === 'new' && <><label className="label" htmlFor="col-name">Name</label><input id="col-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Print queue review" /></>}
    </Modal>
  );
}

function Collections({ onOpen }) {
  const app = useApp();
  const [open, setOpen] = useState(app.collections[0] ? app.collections[0].id : null);
  if (!app.collections.length) return <Empty icon="folder" title="No collections yet">Select saved items and choose Add to collection, or use Create investigation on an answer.</Empty>;
  return (
    <div className="collections">
      {app.collections.map((c) => {
        const items = app.saved.filter((s) => s.collection === c.id);
        const isOpen = open === c.id;
        return (
          <section key={c.id} className="collection">
            <button type="button" className="col-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>
              <Icon name="folder" size={18} /><span className="grow"><b>{c.name}</b><span className="muted small">{items.length} items{c.note ? ` · ${c.note}` : ''}</span></span>
              <Icon name="chevDown" size={16} className={isOpen ? 'rot' : ''} />
            </button>
            {isOpen && (
              <ul className="mini-list">
                {items.map((s) => <li key={s.id}><button type="button" className="link-btn" onClick={() => onOpen(s)}>{s.name}</button><Badge tone="neutral">{s.kind}</Badge></li>)}
                {!items.length && <li className="muted small">Empty collection.</li>}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
