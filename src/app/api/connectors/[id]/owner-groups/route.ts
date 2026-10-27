import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { activeGroups, searchOwnerGroups } from "@/lib/connectors/hda/connector";
import { ConnectorError } from "@/lib/connectors/types";
import { HdaError } from "@/lib/connectors/hda/client";
import { secretReader } from "@/lib/connectors/sync";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

/** Searches HDA owner groups by name or id. The group list is read from HDA once an hour and searched in memory. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/connectors/[id]/owner-groups">) => {
  const session = await requireSession();
  assertPermission(session, "connectors.manage");
  const { id } = await ctx.params;
  const c = await db.connector.findUnique({ where: { id } });
  if (!c || c.type !== "hda") throw new RequestError("That HDA connector no longer exists.", 404);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const config = c.config as Record<string, unknown>;
  const active = activeGroups(config);
  if (!q) return NextResponse.json({ active, results: [] });
  try {
    const results = await searchOwnerGroups({ connectorId: c.id, config, secret: secretReader(c.secretRef) }, q);
    return NextResponse.json({ active, results });
  } catch (e) {
    if (e instanceof HdaError || e instanceof ConnectorError) throw new RequestError(e.message, 502);
    throw e;
  }
});
