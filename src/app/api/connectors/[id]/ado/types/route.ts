import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { adoClientFor, excludedTypes, loadAdoMapping } from "@/lib/connectors/ado/connector";
import { AdoError } from "@/lib/connectors/ado/client";
import { ConnectorError } from "@/lib/connectors/types";
import { secretReader } from "@/lib/connectors/sync";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

/** The project's work item types, how many of each are indexed, and which are skipped. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/connectors/[id]/ado/types">) => {
  const session = await requireSession();
  assertPermission(session, "connectors.manage");
  const { id } = await ctx.params;
  const c = await db.connector.findUnique({ where: { id } });
  if (!c || c.type !== "ado") throw new RequestError("That Azure DevOps connector no longer exists.", 404);
  const config = c.config as Record<string, unknown>;
  const counts = await db.sourceRecord.groupBy({ by: ["category"], where: { connectorId: c.id, sourceSystem: "Azure DevOps", deletedAt: null }, _count: true });
  let types: string[] = [];
  let note: string | null = null;
  try { types = await adoClientFor({ connectorId: c.id, config, secret: secretReader(c.secretRef) }).workItemTypes(); }
  catch (e) { note = `The type list couldn't be read from Azure DevOps (${e instanceof AdoError || e instanceof ConnectorError ? e.message : "error"}); showing the types already indexed.`; }
  const excluded = excludedTypes(config, loadAdoMapping());
  const names = [...new Set([...types, ...counts.map((x) => x.category).filter((x): x is string => !!x), ...excluded])].sort((a, b) => a.localeCompare(b));
  return NextResponse.json({
    note, custom: Array.isArray(config.excludeWorkItemTypes),
    types: names.map((name) => ({ name, indexed: counts.find((x) => x.category === name)?._count ?? 0, excluded: excluded.includes(name) })),
  });
});
