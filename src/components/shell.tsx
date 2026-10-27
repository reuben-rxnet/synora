"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fmtDate, typeText } from "@/lib/format";
import { Badge, Btn, Callout, DemoTag, Drawer, Icon, IconBtn, KindBadge, Logo, Modal, Popover, SourceIcon, StatusPill } from "./ui";

export interface ShellUser {
  displayName: string; initials: string; email: string; jobTitle: string; roles: string[];
  spaces: { id: string; key: string; name: string; role: string }[];
  can: { connectors: boolean; admin: boolean; investigate: boolean };
  demoAuth: boolean;
}

interface ShellApi {
  toast: (msg: string, tone?: "good" | "info" | "bad") => void;
  openRecord: (id: string) => void;
  user: ShellUser;
}

const Ctx = createContext<ShellApi | null>(null);
export const useShell = () => useContext(Ctx)!;

const NAV = [
  ["/", "Search", "search"], ["/similar", "Similar Issues", "similar"], ["/analytics", "Analytics", "chart"],
  ["/sources", "Sources", "plug"], ["/saved", "Saved", "bookmark"], ["/admin", "Administration", "shield"], ["/about", "About", "info"],
] as const;

type Theme = "system" | "light" | "dark";
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

export function Shell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("system");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: string }[]>([]);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | "profile" | "help">(null);

  // Saved preferences exist only in the browser, so they are read after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTheme((store.get("synora-theme") as Theme) || "system"); setCollapsed(store.get("synora-collapsed") === "1"); }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
    store.set("synora-theme", theme);
  }, [theme]);

  const toast = useCallback((msg: string, tone: "good" | "info" | "bad" = "good") => {
    const id = Date.now() + Math.random();
    setToasts((t) => t.concat({ id, msg, tone }));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const nav = NAV.filter(([href]) => (href === "/sources" ? user.can.connectors : href === "/admin" ? user.can.admin : true));
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const nextTheme = { system: "light", light: "dark", dark: "system" } as const;

  return (
    <Ctx.Provider value={{ toast, openRecord: setRecordId, user }}>
      <a href="#main" className="skip">Skip to content</a>
      <div className={"shell " + (collapsed ? "collapsed" : "")}>
        {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} aria-hidden="true" />}
        <nav className={"sidebar " + (mobileNav ? "open" : "")} aria-label="Primary">
          <div className="side-brand">
            <Logo size={30} />
            <div className="brand-text"><b>Synora</b><span>Enterprise intelligence, connected.</span></div>
            <IconBtn icon="x" label="Close navigation" className="only-mobile" onClick={() => setMobileNav(false)} />
          </div>
          <ul className="nav-list">
            {nav.map(([href, label, icon]) => (
              <li key={href}><Link href={href} onClick={() => { setMobileNav(false); setRecordId(null); }} className={"nav-item " + (active(href) ? "active" : "")} aria-current={active(href) ? "page" : undefined} title={collapsed ? label : undefined}>
                <Icon name={icon} size={19} /><span className="nav-label">{label}</span></Link></li>
            ))}
          </ul>
          <div className="nav-bottom">
            <button type="button" className="nav-item" onClick={() => setPanel("help")}><Icon name="help" size={19} /><span className="nav-label">Help</span></button>
            <button type="button" className="nav-item nav-user" onClick={() => setPanel("profile")}>
              <span className="avatar sm">{user.initials}</span><span className="nav-label"><b>{user.displayName}</b><span className="muted small">{user.jobTitle}</span></span></button>
            <button type="button" className="nav-item collapse-btn hide-mobile" onClick={() => { setCollapsed(!collapsed); store.set("synora-collapsed", collapsed ? "0" : "1"); }} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <Icon name="panel" size={19} /><span className="nav-label">Collapse</span></button>
          </div>
        </nav>
        <div className="main-col">
          <header className="topbar">
            <IconBtn icon="menu" label="Open navigation" className="only-mobile" onClick={() => setMobileNav(true)} />
            <div className="brand-top only-mobile"><Logo size={24} /><b>Synora</b></div>
            <div className="top-title hide-mobile"><span className="tagline">Enterprise intelligence, connected.</span></div>
            <div className="top-actions">
              {user.can.connectors && <HealthIndicator />}
              <IconBtn icon={{ system: "monitor", light: "sun", dark: "moon" }[theme]} label={`Theme: ${theme}. Switch to ${nextTheme[theme]}`} onClick={() => setTheme(nextTheme[theme])} />
              <button type="button" className="avatar-btn" aria-label="Open user profile" onClick={() => setPanel("profile")}><span className="avatar">{user.initials}</span></button>
            </div>
          </header>
          <main id="main" className="main" tabIndex={-1}>{children}</main>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="Primary (mobile)">
        {nav.slice(0, 5).map(([href, label, icon]) => (
          <Link key={href} href={href} onClick={() => setRecordId(null)} className={active(href) ? "active" : ""} aria-current={active(href) ? "page" : undefined}><Icon name={icon} size={20} /><span>{label.split(" ")[0]}</span></Link>
        ))}
      </nav>
      {recordId && <RecordDrawer key={recordId} id={recordId} onClose={() => setRecordId(null)} onOpen={setRecordId} />}
      {panel === "profile" && <Profile user={user} theme={theme} setTheme={setTheme} onClose={() => setPanel(null)} />}
      {panel === "help" && <Help onClose={() => setPanel(null)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={"toast t-" + t.tone}><Icon name={t.tone === "good" ? "check" : "info"} size={16} />{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  );
}

function HealthIndicator() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ connectors: { id: string; name: string; status: string }[] } | null>(null);
  useEffect(() => { fetch("/api/connectors").then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => setData(null)); }, [open]);
  const list = data?.connectors ?? [];
  const healthy = list.filter((c) => c.status === "connected" || c.status === "syncing").length;
  const attention = list.filter((c) => ["action_required", "failed"].includes(c.status));
  const tone = attention.some((c) => c.status === "failed") ? "bad" : attention.length ? "warn" : "good";
  return (
    <div className="rel">
      <button type="button" className="health-btn" aria-expanded={open} aria-label={`Connection health: ${healthy} of ${list.length} sources healthy`} onClick={() => setOpen(!open)}>
        <span className={"health-dot hd-" + tone} /><span className="hide-mobile num">{healthy}/{list.length}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="health-pop">
        <h3 className="pop-title">Connection health</h3>
        <p className="muted small">{healthy} of {list.length} sources connected or syncing.</p>
        <ul className="hist-list">{list.filter((c) => c.status !== "connected").map((c) => <li key={c.id}><Link href="/sources" onClick={() => setOpen(false)} className="hist-row"><span className="grow">{c.name}</span><StatusPill status={c.status} /></Link></li>)}</ul>
        <Link className="link-btn" href="/sources" onClick={() => setOpen(false)}>Open Sources <Icon name="right" size={14} /></Link>
      </Popover>
    </div>
  );
}

interface RecordDetail {
  id: string; ref: string; title: string; body: string; sourceSystem: string; connector: string; recordType: string; evidenceKind: string; approval: string;
  application: string | null; module: string | null; environment: string | null; location: string | null; category: string | null; ownerGroup: string | null;
  priority: string | null; status: string | null; rootCause: string | null; resolution: string | null; sourceUrl: string | null; updatedAt: string; space: string;
  sensitivity: string; errorCodes: string[]; demo: boolean;
  linked: { id: string; ref: string; title: string; sourceSystem: string; kind: string }[];
  related: { id: string; ref: string; title: string; sourceSystem: string }[];
  fields: { label: string; value: string; tier?: string; person?: boolean }[];
}

const fieldValue = (v: string) => (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? fmtDate(v) : v);

const KIND_TEXT: Record<string, string> = { approved: "Approved knowledge", historical: "Historical evidence", discussion: "Email or chat discussion", dev_work: "Development work item", reference: "Reference document" };

function RecordDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { toast } = useShell();
  const [r, setR] = useState<RecordDetail | null | "missing">(null);
  const [related, setRelated] = useState(false);
  useEffect(() => { fetch(`/api/records/${id}`).then((x) => (x.ok ? x.json() : "missing")).then(setR).catch(() => setR("missing")); }, [id]);
  const save = async (rec: RecordDetail) => {
    const res = await fetch("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "record", name: `${rec.ref} – ${rec.title.slice(0, 60)}`, recordId: rec.id }) });
    toast(res.ok ? "Pinned. Find it under Saved." : "Couldn't pin this record.", res.ok ? "good" : "bad");
  };
  return (
    <Drawer title="Source preview" onClose={onClose}
      footer={r && r !== "missing" ? <>
        {r.sourceUrl && !r.demo
          ? <a className="btn btn-primary" href={r.sourceUrl} target="_blank" rel="noreferrer"><Icon name="external" size={17} /><span>Open original source</span></a>
          : <Btn icon="external" variant="primary" onClick={() => toast("This is demonstration data, so there is no original record to open.", "info")}>Open original source</Btn>}
        <Btn icon="layers" onClick={() => setRelated(!related)}>{related ? "Hide related items" : "View related items"}</Btn>
        <IconBtn icon="bookmark" label="Pin record" onClick={() => save(r)} />
      </> : null}>
      {r === null && <p className="muted">Loading…</p>}
      {r === "missing" && <Callout tone="info" title="This record isn't available">It may have been removed from the source, or you don&apos;t have access to it.</Callout>}
      {r && r !== "missing" && <>
        <div className="rd-head"><SourceIcon source={r.sourceSystem} size={18} /><div className="min0"><h3 className="rd-title">{r.title}</h3><p className="muted small">{r.sourceSystem} · {typeText(r.recordType)} · <span className="mono">{r.ref}</span></p></div></div>
        <div className="row-wrap tight"><KindBadge kind={r.evidenceKind} />{r.status && <StatusPill status={r.status} />}<Badge tone="neutral" icon="layers">{r.space}</Badge>{r.sensitivity === "restricted" && <Badge tone="warn" icon="lock">Restricted</Badge>}{r.demo && <DemoTag />}</div>
        {r.evidenceKind === "historical" && <Callout tone="info">This resolution is historical and has not been approved as reusable knowledge.</Callout>}
        {r.evidenceKind === "discussion" && <Callout tone="info">Discussion content. Statements here have not been validated.</Callout>}
        {r.evidenceKind === "dev_work" && <Callout tone="info">Development work item. Findings may change as work progresses.</Callout>}
        {r.evidenceKind === "reference" && <Callout tone="info">Reference document. Check it is still current before relying on it.</Callout>}
        <div className="excerpt"><span className="eyebrow">Content</span><blockquote style={{ whiteSpace: "pre-wrap" }}>{r.body.slice(0, 2500)}{r.body.length > 2500 ? "…" : ""}</blockquote></div>
        <dl className="rd-dl">
          <dt>Source system</dt><dd>{r.sourceSystem}</dd>
          <dt>Record type</dt><dd>{typeText(r.recordType)}</dd>
          <dt>Reference</dt><dd className="mono">{r.ref}</dd>
          <dt>Last updated</dt><dd>{fmtDate(r.updatedAt)}</dd>
          {r.ownerGroup && <><dt>Owner group</dt><dd>{r.ownerGroup}</dd></>}
          {r.application && <><dt>Application</dt><dd>{r.application}</dd></>}
          {r.environment && <><dt>Environment</dt><dd>{r.environment}</dd></>}
          {r.location && <><dt>Location</dt><dd>{r.location}</dd></>}
          {r.priority && <><dt>Priority</dt><dd>{r.priority}</dd></>}
          <dt>Knowledge approval</dt><dd>{{ approved: "Approved", historical: "Historical – not approved", not_reviewed: "Not reviewed", draft: "Draft" }[r.approval] ?? r.approval}</dd>
          <dt>Evidence type</dt><dd>{KIND_TEXT[r.evidenceKind] ?? r.evidenceKind}</dd>
          {r.rootCause && <><dt>Root cause</dt><dd>{r.rootCause}</dd></>}
          {r.resolution && <><dt>Resolution</dt><dd>{r.resolution}</dd></>}
          {r.errorCodes.length > 0 && <><dt>Error codes</dt><dd className="mono">{r.errorCodes.join(", ")}</dd></>}
        </dl>
        {r.fields?.length > 0 && (
          <details className="rd-fields">
            <summary className="eyebrow">Source fields ({r.fields.length})</summary>
            <dl className="rd-dl">{r.fields.map((f) => <Fragment key={f.label}><dt>{f.label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{fieldValue(f.value)}</dd></Fragment>)}</dl>
          </details>
        )}
        {related && (
          <div><span className="eyebrow">Linked and related items</span>
            {!r.linked.length && !r.related.length && <p className="muted small">No related items you can access.</p>}
            <ul className="rec-list">{[...r.linked.map((x) => ({ ...x, note: `Linked (${x.kind})` })), ...r.related.map((x) => ({ ...x, note: "Same application" }))].map((x) => (
              <li key={x.id} className="rec-row"><SourceIcon source={x.sourceSystem} size={15} /><button type="button" className="rec-main" onClick={() => onOpen(x.id)}><span className="rec-title">{x.title}</span><span className="muted small"><span className="mono">{x.ref}</span> · {x.sourceSystem} · {x.note}</span></button></li>
            ))}</ul>
          </div>
        )}
      </>}
    </Drawer>
  );
}

function Profile({ user, theme, setTheme, onClose }: { user: ShellUser; theme: Theme; setTheme: (t: Theme) => void; onClose: () => void }) {
  return (
    <Drawer title="Profile" onClose={onClose}>
      <div className="profile-head"><span className="avatar lg">{user.initials}</span><div><h3>{user.displayName}</h3><p className="muted small">{user.email}</p><div className="row-wrap tight">{user.roles.map((r) => <Badge key={r} tone="info" icon="shield">{r.replace(/-/g, " ")}</Badge>)}</div></div></div>
      {user.demoAuth && <Callout tone="info">Demonstration sign-in. No real personal information is used.</Callout>}
      <div><span className="eyebrow">Spaces you can search</span>
        {user.spaces.length ? <ul className="mini-list">{user.spaces.map((s) => <li key={s.id}><span>{s.name}</span><Badge tone="neutral">{s.role}</Badge></li>)}</ul> : <p className="muted small">You aren&apos;t a member of any space, so search returns nothing. Ask an administrator for access.</p>}
      </div>
      <fieldset className="radio-group"><legend className="label">Theme</legend>
        {(["system", "light", "dark"] as const).map((t) => <label key={t} className="radio"><input type="radio" name="p-theme" checked={theme === t} onChange={() => setTheme(t)} />{t[0]!.toUpperCase() + t.slice(1)}</label>)}
      </fieldset>
      <form action="/api/auth/logout" method="post"><Btn type="submit" icon="arrow">Sign out</Btn></form>
    </Drawer>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <Modal title="Help" subtitle="Synora searches the sources your spaces are connected to." onClose={onClose}>
      <span className="eyebrow">Getting started</span>
      <ol className="tour">
        {[["Ask about an issue", "Describe it in your own words on Search.", "/"], ["Find similar issues", "Compare an incident with historical ones.", "/similar"], ["Pin what matters", "Saved keeps searches and records.", "/saved"]].map(([t, d, h]) => (
          <li key={t}><div className="grow"><b>{t}</b><p className="muted small">{d}</p></div><Btn size="sm" onClick={() => go(h!)}>Go</Btn></li>
        ))}
      </ol>
      <span className="eyebrow">How answers work</span>
      <p className="small">Synora only answers from records you are allowed to open. Every claim cites its source. When the evidence is too thin, it says so instead of guessing.</p>
      <span className="eyebrow">Keyboard</span>
      <dl className="rd-dl"><dt><kbd>/</kbd></dt><dd>Focus the search box</dd><dt><kbd>Enter</kbd></dt><dd>Submit (Shift+Enter for a new line)</dd><dt><kbd>Esc</kbd></dt><dd>Close dialogs and panels</dd></dl>
      <Btn icon="book" onClick={() => go("/about#guides")}>Read the full guides</Btn>
    </Modal>
  );
}

export { fmtDate, typeText };
