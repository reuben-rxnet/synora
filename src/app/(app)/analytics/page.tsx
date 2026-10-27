import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageSession } from "@/lib/auth/session";
import { typeText } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

/** Everything here is counted over records the viewer may see, so analytics never reveal other departments' data. */
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

export default async function AnalyticsPage() {
  const s = await requirePageSession();
  const visible = { deletedAt: null, acl: { hasSome: s.principals } };
  const [total, bySpace, bySource, byType, byStatus, byApp, approved, noSolution, linked, searches, insufficient, helpful, recentGaps] = await Promise.all([
    db.sourceRecord.count({ where: visible }),
    db.sourceRecord.groupBy({ by: ["spaceId"], where: visible, _count: true }),
    db.sourceRecord.groupBy({ by: ["sourceSystem"], where: visible, _count: true }),
    db.sourceRecord.groupBy({ by: ["recordType"], where: visible, _count: true }),
    db.sourceRecord.groupBy({ by: ["status"], where: visible, _count: true }),
    db.sourceRecord.groupBy({ by: ["application"], where: { ...visible, application: { not: null } }, _count: true }),
    db.sourceRecord.count({ where: { ...visible, evidenceKind: "approved" } }),
    db.sourceRecord.count({ where: { ...visible, recordType: { in: ["incident", "request", "problem"] }, resolution: null } }),
    db.recordLink.count({ where: { from: visible, to: visible } }),
    db.search.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    db.answer.count({ where: { outcome: "insufficient", createdAt: { gte: daysAgo(30) } } }),
    db.feedback.groupBy({ by: ["helpful"], _count: true }),
    s.permissions.has("admin.view") ? db.answer.findMany({ where: { outcome: "insufficient" }, orderBy: { createdAt: "desc" }, take: 6, include: { search: { select: { query: true } } } }) : Promise.resolve([]),
  ]);
  const spaces = await db.space.findMany({ where: { id: { in: bySpace.map((b) => b.spaceId) } } });
  const up = helpful.find((h) => h.helpful)?._count ?? 0;
  const down = helpful.find((h) => !h.helpful)?._count ?? 0;
  const sorted = <T extends { _count: number }>(xs: T[]) => xs.slice().sort((a, b) => b._count - a._count);

  return (
    <div className="page">
      <header className="page-head"><div><h1>Analytics</h1><p className="muted">Knowledge coverage and search quality, counted over the records you can access.</p></div></header>
      <div className="kpis">
        <Kpi label="Indexed records you can access" value={total} />
        <Kpi label="Approved knowledge articles" value={approved} />
        <Kpi label="Tickets without a documented solution" value={noSolution} tone={noSolution ? "warn" : undefined} />
        <Kpi label="Linked records" value={linked} note="Tickets linked to bugs or documents" />
        <Kpi label="Searches (30 days)" value={searches} note="All users" />
        <Kpi label="No reliable answer (30 days)" value={insufficient} tone={insufficient ? "warn" : undefined} note={searches ? `${Math.round((insufficient / searches) * 100)}% of searches` : undefined} />
      </div>
      <div className="a-grid">
        <Bars title="Records by space" rows={sorted(bySpace).map((b) => ({ label: spaces.find((x) => x.id === b.spaceId)?.name ?? "—", value: b._count }))} />
        <Bars title="Records by source" rows={sorted(bySource).map((b) => ({ label: b.sourceSystem || "—", value: b._count, href: `/?q=${encodeURIComponent(b.sourceSystem)}&mode=records&run=1` }))} />
        <Bars title="Records by type" rows={sorted(byType).map((b) => ({ label: typeText(b.recordType), value: b._count }))} />
        <Bars title="Issues by application" rows={sorted(byApp).slice(0, 8).map((b) => ({ label: b.application ?? "—", value: b._count, href: `/?q=${encodeURIComponent(b.application ?? "")}&mode=records&run=1` }))} />
        <Bars title="Records by status" rows={sorted(byStatus).map((b) => ({ label: b.status ?? "No status", value: b._count }))} />
        <section className="card">
          <header className="card-head"><h2>Answer feedback</h2><span className="muted small">All time, all users</span></header>
          <div className="stat-row"><div className="stat"><span className="kpi-label">Helpful</span><span className="kpi-val num">{up}</span></div><div className="stat"><span className="kpi-label">Not helpful</span><span className="kpi-val num">{down}</span></div></div>
        </section>
        {s.permissions.has("admin.view") && (
          <section className="card card-wide">
            <header className="card-head"><h2>Recent searches with no reliable answer</h2><span className="muted small">Visible to administrators. Each is a possible knowledge gap.</span></header>
            {recentGaps.length ? <ul className="gap-list">{recentGaps.map((g) => <li key={g.id}><Link href={`/?q=${encodeURIComponent(g.search.query)}&run=1`} className="hist-row"><span className="grow">{g.search.query}</span><span className="muted small">{g.createdAt.toLocaleDateString("en-GB")}</span></Link></li>)}</ul> : <p className="muted small">None yet.</p>}
          </section>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: "warn" | "bad" }) {
  return <div className={"kpi " + (tone ? "kpi-" + tone : "")} style={{ cursor: "default" }}><span className="kpi-label">{label}</span><span className="kpi-val num">{value.toLocaleString("en-US")}</span>{note && <span className="muted small">{note}</span>}</div>;
}

function Bars({ title, rows }: { title: string; rows: { label: string; value: number; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="card">
      <header className="card-head"><h2>{title}</h2></header>
      <ul className="barlist">
        {rows.map((r) => {
          const inner = <><span className="barlist-label">{r.label}</span><span className="barlist-track"><span className="barlist-fill" style={{ width: `${(r.value / max) * 100}%` }} /></span><span className="barlist-val num">{r.value}</span></>;
          return <li key={r.label}>{r.href ? <Link className="barlist-row" href={r.href} style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link> : <div className="barlist-row" style={{ cursor: "default" }}>{inner}</div>}</li>;
        })}
        {!rows.length && <li className="muted small">No records yet.</li>}
      </ul>
    </section>
  );
}
