import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { graphFor } from "@/lib/connectors/m365/connector";
import { GraphError } from "@/lib/connectors/m365/graph";
import { ConnectorError } from "@/lib/connectors/types";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

const isSharePointUrl = (s: string) => { try { const u = new URL(s); return u.protocol === "https:" && /\.sharepoint\.com$/i.test(u.hostname); } catch { return false; } };

/**
 * Folder picker for the SharePoint & OneDrive connector, as the signed-in Microsoft 365 account sees it.
 *   ?site=<url>            → the site's document libraries, plus the account's own OneDrive
 *   ?drive=<id>&item=<id>  → the folders inside a library or folder (item defaults to its root)
 */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/connectors/[id]/m365/browse">) => {
  const session = await requireSession();
  assertPermission(session, "connectors.manage");
  const { id } = await ctx.params;
  const c = await db.connector.findUnique({ where: { id } });
  if (!c || c.type !== "m365") throw new RequestError("That connector no longer exists.", 404);
  const q = new URL(req.url).searchParams;
  const g = graphFor(c.id);
  try {
    const drive = q.get("drive");
    if (drive) {
      const item = q.get("item") || "root";
      const children = await g.children(drive, item);
      return NextResponse.json({
        folders: children.filter((x) => x.folder && !x.package).map((x) => ({ itemId: x.id, name: x.name, childCount: x.folder?.childCount ?? 0, webUrl: x.webUrl })).sort((a, b) => a.name.localeCompare(b.name)),
        fileCount: children.filter((x) => x.file).length,
        rootId: item === "root" ? (await g.item(drive, "root")).id : item,
      });
    }
    const siteUrl = (q.get("site") || String((c.config as { siteUrl?: string }).siteUrl ?? "")).trim();
    if (siteUrl && !isSharePointUrl(siteUrl)) throw new RequestError("Enter a SharePoint site address, like https://contoso.sharepoint.com/sites/Team.");
    let site: { name: string; webUrl: string; libraries: { driveId: string; name: string }[] } | null = null;
    let siteError: string | null = null;
    if (siteUrl) {
      try {
        const s = await g.site(siteUrl);
        site = { name: s.displayName, webUrl: s.webUrl, libraries: (await g.siteDrives(s.id)).filter((d) => d.driveType === "documentLibrary").map((d) => ({ driveId: d.id, name: d.name })) };
      } catch (e) { siteError = e instanceof GraphError ? e.message : "The site couldn't be opened."; }
    }
    const mine = await g.myDrive().catch(() => null);
    return NextResponse.json({ site, siteError, siteUrl, onedrive: mine ? { driveId: mine.id, name: "My OneDrive" } : null });
  } catch (e) {
    if (e instanceof ConnectorError || e instanceof GraphError) throw new RequestError(e.message, e instanceof ConnectorError && e.code === "AUTH" ? 401 : 502);
    throw e;
  }
});
