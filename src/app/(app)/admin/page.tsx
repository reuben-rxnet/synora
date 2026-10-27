import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageSession } from "@/lib/auth/session";
import { ROLE_LABELS, parseRoles } from "@/lib/access";
import { activeProvider } from "@/lib/search/answer";
import { loadOpenAIConfig } from "@/lib/ai/openai/config";
import { setUserRoles, setSpaceMembership } from "@/server/admin-actions";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

const SECTIONS = [["users", "Users and roles"], ["spaces", "Spaces and access"], ["ai", "AI configuration"], ["audit", "Audit activity"], ["health", "System health"]] as const;

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const s = await requirePageSession();
  if (!s.permissions.has("admin.view")) redirect("/");
  const sp = await searchParams;
  const section = SECTIONS.find(([k]) => k === sp.section)?.[0] ?? (s.permissions.has("admin.manage") ? "users" : "audit");
  const canManage = s.permissions.has("admin.manage");

  return (
    <div className="page">
      <header className="page-head"><div><h1>Administration</h1><p className="muted">People, spaces, the AI provider and platform health.</p></div></header>
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Administration sections">
          <ul className="admin-links">
            {SECTIONS.map(([k, l]) => <li key={k}><Link href={`/admin?section=${k}`} className={"admin-link " + (section === k ? "active" : "")} aria-current={section === k ? "page" : undefined} style={{ textDecoration: "none" }}>{l}</Link></li>)}
          </ul>
        </nav>
        <section className="admin-body" aria-labelledby="admin-h">
          <h2 id="admin-h" className="h2">{SECTIONS.find(([k]) => k === section)![1]}</h2>
          {section === "users" && <Users canManage={canManage} />}
          {section === "spaces" && <Spaces canManage={canManage} />}
          {section === "ai" && <AiConfig />}
          {section === "audit" && <Audit />}
          {section === "health" && <Health />}
        </section>
      </div>
    </div>
  );
}

async function Users({ canManage }: { canManage: boolean }) {
  const users = await db.user.findMany({ where: { active: true }, orderBy: { displayName: "asc" }, include: { spaces: { include: { space: true } } } });
  return (
    <>
      <p className="muted small">With Entra ID sign-in, roles come from the Synora app roles in Entra and are refreshed at each sign-in. Changes here apply to demo users and until the next sign-in.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Department</th><th>Spaces</th><th>Roles</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><b>{u.displayName}</b><br /><span className="muted small">{u.email}</span></td>
            <td>{u.department}</td>
            <td>{u.spaces.map((m) => `${m.space.name} (${m.role})`).join(", ") || "—"}</td>
            <td>{canManage ? (
              <form action={setUserRoles} className="row tight">
                <input type="hidden" name="userId" value={u.id} />
                <select name="role" className="input input-sm" defaultValue={parseRoles(u.roles)[0] ?? "search-user"} aria-label={`Role for ${u.displayName}`}>
                  {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button className="btn btn-sm" type="submit">Save</button>
              </form>
            ) : parseRoles(u.roles).map((r) => ROLE_LABELS[r]).join(", ")}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

async function Spaces({ canManage }: { canManage: boolean }) {
  const [spaces, users] = await Promise.all([
    db.space.findMany({ orderBy: { name: "asc" }, include: { members: { include: { user: true } }, _count: { select: { records: true } } } }),
    db.user.findMany({ where: { active: true }, orderBy: { displayName: "asc" } }),
  ]);
  return (
    <>
      <p className="muted small">A space is a department or domain. People search only the spaces they belong to; restricted records (such as HR cases) are visible only to their owner group even inside the space.</p>
      <div className="role-grid">{spaces.map((sp) => (
        <div key={sp.id} className="role-card">
          <b>{sp.name}</b><span className="muted small">{sp.description}</span>
          <span className="small">{sp._count.records} records · {sp.members.length} members{sp.visibility === "restricted" ? " · restricted" : ""}</span>
          <span className="small muted">{sp.members.map((m) => m.user.displayName).join(", ") || "No members"}</span>
          {canManage && (
            <form action={setSpaceMembership} className="row tight" style={{ marginTop: 6, flexWrap: "wrap" }}>
              <input type="hidden" name="spaceId" value={sp.id} />
              <select name="userId" className="input input-sm" aria-label={`Person for ${sp.name}`}>{users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select>
              <select name="role" className="input input-sm" aria-label="Space role" defaultValue="member"><option value="member">Member</option><option value="editor">Editor</option><option value="owner">Owner</option><option value="remove">Remove</option></select>
              <button className="btn btn-sm" type="submit">Apply</button>
            </form>
          )}
        </div>
      ))}</div>
    </>
  );
}

function AiConfig() {
  const { provider, note } = activeProvider();
  let cfg: ReturnType<typeof loadOpenAIConfig> | null = null;
  let error: string | null = null;
  try { cfg = loadOpenAIConfig(); } catch (e) { error = e instanceof Error ? e.message : "Not configured"; }
  return (
    <div className="panel narrow">
      <div className="callout c-info"><div className="callout-body">Codex may assist with development and code review, while the configured model provider supplies the production reasoning capability.</div></div>
      <dl className="rd-dl">
        <dt>Answers written by</dt><dd><b>{provider === "openai" ? "Codex through the APIM gateway" : "Synora without AI (extracts from evidence)"}</b></dd>
        {note && <><dt>Why</dt><dd>{note}</dd></>}
        <dt>Setting</dt><dd className="mono">AI_PROVIDER={process.env.AI_PROVIDER || "mock"}</dd>
        {cfg && <><dt>Endpoint</dt><dd className="mono">{cfg.baseUrl}</dd><dt>Deployment</dt><dd className="mono">{cfg.modelId}</dd><dt>API style</dt><dd>{cfg.apiStyle}</dd>
          <dt>Key</dt><dd>{process.env.OPENAI_API_KEY ? "Set (never shown)" : "Not set"} · sent as {cfg.auth.location === "QUERY_PARAMETER" ? `query parameter ${cfg.auth.parameterName}` : `header ${cfg.auth.headerName}`}</dd>
          <dt>Allowed hosts</dt><dd className="mono">{cfg.allowedHosts.join(", ")}</dd>
          <dt>Data-processing approval</dt><dd>{cfg.approvalRef ?? "Not set: external AI stays off"}</dd></>}
        {error && <><dt>Configuration</dt><dd>{error}</dd></>}
        <dt>Embeddings</dt><dd>{process.env.EMBEDDING_PROVIDER === "hash" ? "Hashed words (tests only)" : `${process.env.EMBEDDING_MODEL || "Xenova/multilingual-e5-small"} on this server; content never leaves it`}</dd>
        <dt>Rules</dt><dd>Strict JSON schema, no tools, store=false. Citations required; answers withheld when evidence is insufficient. Confidence is calculated from evidence.</dd>
      </dl>
      <p className="hint">Provider settings live in the environment (Key Vault in production) and can&apos;t be changed from this page.</p>
    </div>
  );
}

async function Audit() {
  const events = await db.auditEvent.findMany({ orderBy: { at: "desc" }, take: 60 });
  const users = await db.user.findMany({ where: { id: { in: events.flatMap((e) => (e.actorId ? [e.actorId] : [])) } }, select: { id: true, displayName: true } });
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead>
      <tbody>{events.map((e) => <tr key={e.id}><td>{e.at.toLocaleString("en-GB")}</td><td>{users.find((u) => u.id === e.actorId)?.displayName ?? "System"}</td><td className="mono">{e.action}</td><td>{e.action.startsWith("search.") ? "(query kept with the user's history)" : e.target}</td></tr>)}</tbody>
    </table></div>
  );
}

async function Health() {
  const [db1, records, chunks, queued, failedJobs, connectors] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    db.sourceRecord.count({ where: { deletedAt: null } }),
    db.chunk.count(),
    db.job.count({ where: { status: "queued" } }),
    db.job.count({ where: { status: "failed" } }),
    db.connector.groupBy({ by: ["status"], _count: true }),
  ]);
  const rows: [string, string, boolean][] = [
    ["Database", db1 ? "Reachable" : "Unreachable", db1],
    ["Search index", `${records} records · ${chunks} passages`, chunks > 0],
    ["Sync queue", `${queued} waiting · ${failedJobs} failed`, failedJobs === 0],
    ["Connectors", connectors.map((c) => `${c._count} ${c.status.replace("_", " ")}`).join(" · "), !connectors.some((c) => c.status === "failed")],
  ];
  return <ul className="health-list">{rows.map(([n, d, ok]) => <li key={n}><span className={"health-dot hd-" + (ok ? "good" : "warn")} aria-hidden="true" /><b className="grow">{n}</b><span className="muted small">{d}</span></li>)}</ul>;
}
