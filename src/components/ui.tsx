"use client";
// Shared UI primitives, ported from the prototype (prototype/src/ui.jsx).
/* eslint-disable @typescript-eslint/no-explicit-any -- ported from the untyped prototype */
import { useEffect, useRef, useState, type ReactNode } from "react";

const P: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  similar: <><rect x="3" y="4" width="8" height="16" rx="2" /><rect x="13" y="4" width="8" height="16" rx="2" /><path d="M7 9h0M17 9h0M7 13h0M17 13h0" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  plug: <><path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" /></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  monitor: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  paperclip: <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />,
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  sparkles: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  up: <path d="M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 18.2 21H7" />,
  down: <path d="M17 14V3h4v11zM17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.3-8A2 2 0 0 1 5.8 3H17" />,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></>,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  right: <path d="m9 6 6 6-6 6" />,
  left: <path d="m15 6-6 6 6 6" />,
  chevDown: <path d="m6 9 6 6 6-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: <><path d="M12 3 2 21h20z" /><path d="M12 10v4M12 17.5h0" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h0" /></>,
  refresh: <><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12A9 9 0 0 1 18.5 5.8L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M7 4v16l13-8z" />,
  more: <path d="M5 12h0M12 12h0M19 12h0" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  tag: <><path d="M3 12V3h9l9 9-9 9z" /><path d="M7.5 7.5h0" /></>,
  folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  file: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  ticket: <path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3zM14 6v12" />,
  bug: <><rect x="7" y="8" width="10" height="12" rx="5" /><path d="M12 8V5M9 5l1.5 1.5M15 5l-1.5 1.5M3 13h4M17 13h4M4 19l3-2M20 19l-3-2M4 7l3 2M20 7l-3 2" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18" /></>,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 7M18 13.5a6 6 0 0 1 4 6.5" /></>,
  layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h0M3 12h0M3 18h0" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  link: <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  book: <path d="M4 4h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-1 .2M20 4v15h-7" />,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
};

export function Icon({ name, size = 18, className = '', label }: any) {
  return (
    <svg className={'ico ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      {P[name] || P.info}
    </svg>
  );
}

export function SourceIcon({ source, size = 18 }: any) {
  const map: Record<string, string> = { 'HDA Ticketing': 'ticket', hda: 'ticket', 'Azure DevOps': 'bug', ado: 'bug', SharePoint: 'layers', sharepoint: 'layers', OneDrive: 'folder', onedrive: 'folder', Outlook: 'mail', outlook: 'mail', Teams: 'chat', teams: 'chat', Confluence: 'book', confluence: 'book', 'Knowledge base': 'book', sql: 'database', rest: 'code', mcp: 'cpu' };
  const tone: Record<string, string> = { ticket: 't1', bug: 't2', layers: 't3', folder: 't3', mail: 't4', chat: 't2', book: 't5', database: 't1', code: 't5', cpu: 't2' };
  const n = map[source] || 'file';
  return <span className={'src-ico ' + tone[n]} style={{ width: size + 14, height: size + 14 }}><Icon name={n} size={size} /></span>;
}

export function Logo({ size = 28 }: any) {
  // Connected-node mark: three linked nodes forming an open "S" signal path.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="lg-syn" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-a)" />
          <stop offset="1" stopColor="var(--brand-b)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg-syn)" />
      <path d="M10 11.5h8.5a3 3 0 0 1 0 6h-5a3 3 0 0 0 0 6H22" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="10" cy="11.5" r="2.6" fill="#fff" />
      <circle cx="22" cy="23.5" r="2.6" fill="#fff" />
      <circle cx="16" cy="17.5" r="1.7" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function Btn({ children, variant = 'secondary', size, icon, iconRight, className = '', ...rest }: any) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? 'btn-' + size : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 15 : 17} />}
    </button>
  );
}

export function IconBtn({ icon, label, className = '', badge, ...rest }: any) {
  return (
    <button type="button" className={'icon-btn ' + className} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
      {badge ? <span className="dot-badge" aria-hidden="true">{badge}</span> : null}
    </button>
  );
}

export function Badge({ tone = 'neutral', children, icon, className = '' }: any) {
  return <span className={`badge b-${tone} ${className}`}>{icon && <Icon name={icon} size={13} />}{children}</span>;
}

export function DemoTag({ children = 'Demonstration data' }: any) {
  return <span className="demo-tag"><Icon name="info" size={13} />{children}</span>;
}

const STATUS_TEXT: Record<string, string> = { connected: 'Connected', syncing: 'Syncing', action_required: 'Action required', paused: 'Paused', failed: 'Failed', not_configured: 'Not configured', succeeded: 'Succeeded', partial: 'Partial', running: 'Running', review: 'In review', approved: 'Approved', published: 'Published', rejected: 'Rejected', changes_requested: 'Changes requested' };

export function StatusPill({ status }: any) {
  const tone = ({
    Connected: 'good', Syncing: 'info', 'Action required': 'warn', Paused: 'neutral', 'Not configured': 'muted', Failed: 'bad',
    Open: 'warn', 'In progress': 'info', 'Under investigation': 'violet', Resolved: 'good', Closed: 'neutral', Published: 'good', Thread: 'neutral',
    Operational: 'good', Degraded: 'warn', connected: 'good', syncing: 'info', action_required: 'warn', paused: 'neutral', failed: 'bad', not_configured: 'muted', succeeded: 'good', partial: 'warn', running: 'info', review: 'info', approved: 'good', published: 'good', rejected: 'bad', changes_requested: 'warn', Draft: 'neutral', Review: 'info', Approved: 'good', Archived: 'muted', 'Changes requested': 'warn', Rejected: 'bad',
  } as Record<string, string>)[status] || 'neutral';
  const icon = ({ good: 'check', warn: 'alert', bad: 'alert', info: 'refresh' } as Record<string, string>)[tone];
  return <Badge tone={tone} icon={icon}>{STATUS_TEXT[status] ?? status}</Badge>;
}

export function KindBadge({ kind }: any) {
  const m = ({
    approved: ['good', 'check', 'Approved knowledge'], historical: ['info', 'history', 'Historical record'], discussion: ['neutral', 'mail', 'Discussion'], dev_work: ['violet', 'code', 'Development work item'],
    email: ['neutral', 'mail', 'Discussion'], devwork: ['violet', 'code', 'Development work item'], ai: ['ai', 'sparkles', 'AI-generated interpretation'],
  } as Record<string, string[]>)[kind] || ['neutral', 'file', kind];
  return <Badge tone={m[0]} icon={m[1]}>{m[2]}</Badge>;
}

function useEscape(onClose: any, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, active]);
}

function useAutoFocus(ref: any) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el: HTMLElement | null = ref.current && ref.current.querySelector('[data-autofocus], input, select, textarea, button');
    if (el) el.focus();
    return () => { if (prev && prev.focus) prev.focus(); };
  }, [ref]);
}

function trapTab(e: any, ref: any) {
  if (e.key !== 'Tab' || !ref.current) return;
  const f = ref.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function Modal({ title, subtitle, onClose, children, footer, size = 'md' }: any) {
  const ref = useRef<any>(null);
  useEscape(onClose);
  useAutoFocus(ref);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal modal-' + size} role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={(e) => trapTab(e, ref)}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer, side = 'right', wide }: any) {
  const ref = useRef<any>(null);
  useEscape(onClose);
  useAutoFocus(ref);
  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`drawer drawer-${side} ${wide ? 'drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} onKeyDown={(e) => trapTab(e, ref)}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="drawer-head">
          <h2>{title}</h2>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Popover({ open, onClose, children, align = 'right', className = '' }: any) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={`popover pop-${align} ${className}`} role="dialog">{children}</div>;
}

export function Menu({ label, icon = 'more', items, align = 'right', btnClass = '' }: any) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="rel">
      <IconBtn icon={icon} label={label} className={btnClass} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={close} align={align} className="menu">
        <div role="menu">
          {items.map((it: any) => (
            <button key={it.label} role="menuitem" type="button" className={'menu-item ' + (it.danger ? 'danger' : '')} onClick={() => { close(); it.onClick(); }}>
              {it.icon && <Icon name={it.icon} size={16} />}{it.label}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export function Field({ label, hint, children, id }: any) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Select({ id, value, onChange, options, label, className = '' }: any) {
  return (
    <select id={id} className={'input ' + className} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {options.map((o: any) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ id, checked, onChange, label, desc }: any) {
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <label htmlFor={id}>{label}</label>
        {desc && <p className="hint">{desc}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} className={'switch ' + (checked ? 'on' : '')} onClick={() => onChange(!checked)}>
        <span className="knob" />
      </button>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }: any) {
  const onKey = (e: any, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[n].value);
    const el = e.currentTarget.parentElement.children[n];
    if (el) el.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t: any, i: number) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} tabIndex={value === t.value ? 0 : -1}
          className={'tab ' + (value === t.value ? 'active' : '')} onClick={() => onChange(t.value)} onKeyDown={(e) => onKey(e, i)}>
          {t.icon && <Icon name={t.icon} size={16} />}{t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon = 'search', title, children, action }: any) {
  return (
    <div className="empty">
      <span className="empty-ico"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Callout({ tone = 'info', icon, title, children, action }: any) {
  return (
    <div className={'callout c-' + tone} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={icon || (tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert')} size={18} />
      <div className="callout-body">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Meter({ value, tone }: any) {
  return <span className="meter" aria-hidden="true"><span className={'meter-fill ' + (tone || '')} style={{ width: Math.max(0, Math.min(100, value)) + '%' }} /></span>;
}

export function Similarity({ value }: any) {
  const tone = value >= 85 ? 'hi' : value >= 70 ? 'mid' : 'lo';
  return (
    <span className={'sim sim-' + tone} aria-label={`Similarity ${value} percent`}>
      <svg width="34" height="34" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" strokeWidth="3.5" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * 94.2} 94.2`} transform="rotate(-90 18 18)" />
      </svg>
      <b>{value}%</b>
    </span>
  );
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch { return false; }
  }
}

export function fmtNum(n: number | null | undefined) { return n == null ? '—' : n.toLocaleString('en-US'); }
