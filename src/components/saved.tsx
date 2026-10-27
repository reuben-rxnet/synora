"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fmtDate, useShell } from "./shell";
import { Badge, Btn, Empty, Icon, Menu, Modal, Tabs } from "./ui";

interface Item { id: string; kind: "search" | "answer" | "record"; name: string; query: string | null; mode: string | null; recordId: string | null; tags: string[]; collectionId: string | null; createdAt: string; record: { ref: string; sourceSystem: string } | null; unavailable: boolean }
interface Collection { id: string; name: string; note: string }

export function SavedClient() {
  const { toast, openRecord } = useShell();
  const router = useRouter();
  const [data, setData] = useState<{ items: Item[]; collections: Collection[] } | null>(null);
  const [tab, setTab] = useState("answer");
  const [sel, setSel] = useState<string[]>([]);
  const [grouping, setGrouping] = useState(false);

  const load = useCallback(async () => { const r = await fetch("/api/saved"); if (r.ok) setData(await r.json()); }, []);
  useEffect(() => { fetch("/api/saved").then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => undefined); }, []);
  const patch = async (body: Record<string, unknown>, msg?: string) => {
    const r = await fetch("/api/saved", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (msg) toast(r.ok ? msg : "That change couldn't be saved.", r.ok ? "good" : "bad");
    await load();
  };
  const remove = async (ids: string[]) => {
    const r = await fetch("/api/saved", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    toast(r.ok ? `${ids.length} item${ids.length > 1 ? "s" : ""} removed` : "Couldn't remove.", r.ok ? "info" : "bad");
    setSel([]); await load();
  };
  const open = (i: Item) => {
    if (i.recordId) { if (i.unavailable) toast("This record is no longer available to you.", "info"); else openRecord(i.recordId); return; }
    if (i.query) router.push(`/?q=${encodeURIComponent(i.query)}&mode=${i.mode ?? "ask"}&run=1`);
  };

  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const kinds = [{ value: "answer", label: "Saved answers", icon: "sparkles" }, { value: "search", label: "Saved searches", icon: "search" }, { value: "record", label: "Pinned records", icon: "bookmark" }, { value: "collections", label: "Collections", icon: "folder" }];
  const items = data.items.filter((i) => i.kind === tab);

  return (
    <div className="page">
      <header className="page-head"><div><h1>Saved</h1><p className="muted">Answers, searches and records you want to come back to. Only you can see them.</p></div></header>
      <Tabs label="Saved item types" value={tab} onChange={(v: string) => { setTab(v); setSel([]); }} tabs={kinds.map((k) => ({ ...k, count: k.value === "collections" ? data.collections.length : data.items.filter((i) => i.kind === k.value).length }))} />
      <div className="tab-panel">
        {tab !== "collections" && <>
          {sel.length > 0 && (
            <div className="bulk-bar" role="region" aria-label="Selection actions">
              <b>{sel.length} selected</b>
              <Btn size="sm" icon="folder" onClick={() => setGrouping(true)}>Add to collection</Btn>
              <Btn size="sm" variant="danger-ghost" icon="trash" onClick={() => remove(sel)}>Remove</Btn>
              <button type="button" className="link-btn" onClick={() => setSel([])}>Clear selection</button>
            </div>
          )}
          {!items.length && <Empty icon="bookmark" title="Nothing saved here yet">Use Save on an answer, or Pin on a record.</Empty>}
          {items.length > 0 && <ul className="saved-list">{items.map((i) => <Row key={i.id} i={i} checked={sel.includes(i.id)} collection={data.collections.find((c) => c.id === i.collectionId)} onCheck={() => setSel(sel.includes(i.id) ? sel.filter((x) => x !== i.id) : sel.concat(i.id))} onOpen={() => open(i)} onPatch={patch} onRemove={() => remove([i.id])} />)}</ul>}
        </>}
        {tab === "collections" && (data.collections.length ? (
          <div className="collections">{data.collections.map((c) => {
            const its = data.items.filter((i) => i.collectionId === c.id);
            return (
              <section key={c.id} className="collection">
                <div className="col-head"><Icon name="folder" size={18} /><span className="grow"><b>{c.name}</b><span className="muted small">{its.length} items</span></span></div>
                <ul className="mini-list">{its.map((i) => <li key={i.id}><button type="button" className="link-btn" onClick={() => open(i)}>{i.name}</button><Badge tone="neutral">{i.kind}</Badge></li>)}{!its.length && <li className="muted small">Empty collection.</li>}</ul>
              </section>
            );
          })}</div>
        ) : <Empty icon="folder" title="No collections yet">Select saved items and choose Add to collection, or use Create investigation on an answer.</Empty>)}
      </div>
      {grouping && <GroupModal collections={data.collections} onClose={() => setGrouping(false)} onDone={async (target, name) => {
        for (const id of sel) await patch(target === "new" ? { id, newCollection: name } : { id, collectionId: target });
        setGrouping(false); setSel([]); toast("Added to collection");
      }} />}
    </div>
  );
}

function Row({ i, checked, collection, onCheck, onOpen, onPatch, onRemove }: { i: Item; checked: boolean; collection?: Collection; onCheck: () => void; onOpen: () => void; onPatch: (b: Record<string, unknown>, msg?: string) => Promise<void>; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(i.name);
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState("");
  return (
    <li className="saved-row">
      <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${i.name}`} />
      <div className="grow min0">
        {editing ? (
          <form className="row tight" onSubmit={(e) => { e.preventDefault(); setEditing(false); void onPatch({ id: i.id, name: name.trim() || i.name }, "Renamed"); }}>
            <label htmlFor={"rn-" + i.id} className="sr-only">Name</label>
            <input id={"rn-" + i.id} className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Btn size="sm" variant="primary" type="submit">Save</Btn><Btn size="sm" variant="ghost" onClick={() => { setName(i.name); setEditing(false); }}>Cancel</Btn>
          </form>
        ) : <button type="button" className="saved-name" onClick={onOpen}>{i.name}</button>}
        <p className="muted small">{i.record ? `${i.record.ref} · ${i.record.sourceSystem}` : i.unavailable ? "No longer available to you" : i.query ? `“${i.query.slice(0, 100)}”` : ""} · Saved {fmtDate(i.createdAt)}{collection ? ` · In ${collection.name}` : ""}</p>
        <div className="chip-row tight">
          {i.tags.map((t) => <span key={t} className="fchip sm">{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => onPatch({ id: i.id, tags: i.tags.filter((x) => x !== t) })}><Icon name="x" size={12} /></button></span>)}
          {tagging ? (
            <form onSubmit={(e) => { e.preventDefault(); if (tag.trim()) void onPatch({ id: i.id, tags: [...new Set(i.tags.concat(tag.trim()))] }); setTag(""); setTagging(false); }}>
              <label htmlFor={"tg-" + i.id} className="sr-only">New tag</label>
              <input id={"tg-" + i.id} className="input input-xs" value={tag} onChange={(e) => setTag(e.target.value)} onBlur={() => setTagging(false)} autoFocus placeholder="tag" />
            </form>
          ) : <button type="button" className="add-tag" onClick={() => setTagging(true)}><Icon name="tag" size={12} />Add tag</button>}
        </div>
      </div>
      <Btn size="sm" icon={i.query ? "search" : "eye"} onClick={onOpen}>Open</Btn>
      <Menu label={`Actions for ${i.name}`} items={[{ label: "Rename", icon: "edit", onClick: () => setEditing(true) }, { label: "Add tag", icon: "tag", onClick: () => setTagging(true) }, { label: "Remove", icon: "trash", danger: true, onClick: onRemove }]} />
    </li>
  );
}

function GroupModal({ collections, onClose, onDone }: { collections: Collection[]; onClose: () => void; onDone: (target: string, name: string) => void }) {
  const [target, setTarget] = useState(collections[0]?.id ?? "new");
  const [name, setName] = useState("");
  return (
    <Modal title="Add to collection" onClose={onClose} size="sm"
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={target === "new" && !name.trim()} onClick={() => onDone(target, name.trim())}>Add</Btn></>}>
      <fieldset className="radio-group"><legend className="label">Collection</legend>
        {collections.map((c) => <label key={c.id} className="radio"><input type="radio" name="col" checked={target === c.id} onChange={() => setTarget(c.id)} />{c.name}</label>)}
        <label className="radio"><input type="radio" name="col" checked={target === "new"} onChange={() => setTarget("new")} />New collection</label>
      </fieldset>
      {target === "new" && <><label className="label" htmlFor="col-name">Name</label><input id="col-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Print queue review" /></>}
    </Modal>
  );
}
