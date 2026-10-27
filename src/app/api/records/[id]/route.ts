import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canSee } from "@/lib/access";
import { requireSession } from "@/lib/auth/session";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

type SourceField = { label: string; value: string; tier?: string; person?: boolean };
const sourceFields = (raw: unknown): SourceField[] => {
  const f = (raw as { fields?: unknown } | null)?.fields;
  return Array.isArray(f) ? (f as SourceField[]).filter((x) => x && typeof x.label === "string" && typeof x.value === "string").map(({ label, value, tier, person }) => ({ label, value, tier, person })) : [];
};

/** One record for the source preview. A record the person can't see answers 404, not 403, so its existence isn't revealed. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/records/[id]">) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const r = await db.sourceRecord.findFirst({
    where: { id, deletedAt: null },
    include: { space: { select: { name: true } }, connector: { select: { name: true } }, linksFrom: { include: { to: true } }, linksTo: { include: { from: true } } },
  });
  if (!r || !canSee(r.acl, session.principals)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.auditEvent.create({ data: { actorId: session.user.id, action: "record.view", target: r.ref, detail: { recordId: r.id } } });

  const linked = [...r.linksFrom.map((l) => ({ rec: l.to, kind: l.kind })), ...r.linksTo.map((l) => ({ rec: l.from, kind: l.kind }))].filter((l) => canSee(l.rec.acl, session.principals) && !l.rec.deletedAt);
  const sameApp = r.application ? await db.sourceRecord.findMany({
    where: { application: r.application, id: { not: r.id }, deletedAt: null, acl: { hasSome: session.principals } },
    take: 5, orderBy: { sourceUpdatedAt: "desc" }, select: { id: true, ref: true, title: true, sourceSystem: true, recordType: true, evidenceKind: true, status: true },
  }) : [];
  const pick = (x: typeof r | (typeof linked)[number]["rec"]) => ({ id: x.id, ref: x.ref, title: x.title, sourceSystem: x.sourceSystem, recordType: x.recordType, evidenceKind: x.evidenceKind, status: x.status });

  return NextResponse.json({
    id: r.id, ref: r.ref, title: r.title, body: r.body, sourceSystem: r.sourceSystem, connector: r.connector.name, recordType: r.recordType,
    evidenceKind: r.evidenceKind, approval: r.approval, application: r.application, module: r.module, environment: r.environment,
    location: r.location, category: r.category, ownerGroup: r.ownerGroup, priority: r.priority, status: r.status, rootCause: r.rootCause,
    resolution: r.resolution, sourceUrl: r.sourceUrl, updatedAt: (r.sourceUpdatedAt ?? r.indexedAt).toISOString(), space: r.space.name,
    sensitivity: r.sensitivity, errorCodes: r.errorCodes, demo: (r.raw as { demo?: boolean } | null)?.demo === true,
    // Extended source fields (HDA's mapping). Only people who can see the record get here, so names may be shown.
    fields: sourceFields(r.raw),
    linked: linked.map((l) => ({ ...pick(l.rec), kind: l.kind })),
    related: sameApp.filter((x) => !linked.some((l) => l.rec.id === x.id)),
  });
});
