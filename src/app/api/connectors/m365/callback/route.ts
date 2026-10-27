import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { exchangeCode, forgetToken, m365Config, saveCredential } from "@/lib/connectors/m365/auth";
import { chosenFolders } from "@/lib/connectors/m365/connector";
import { GraphClient } from "@/lib/connectors/m365/graph";
import { M365_COOKIE, M365_COOKIE_PATH, readPending } from "@/lib/connectors/m365/state-cookie";

export const dynamic = "force-dynamic";

/** Microsoft's redirect after the Microsoft 365 sign-in: stores the (encrypted) sign-in for the connector. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/sources?${q}`, req.url));
    res.cookies.delete({ name: M365_COOKIE, path: M365_COOKIE_PATH });
    return res;
  };
  const pending = readPending(req.headers.get("cookie")?.match(new RegExp(`${M365_COOKIE}=([^;]+)`))?.[1]);
  const session = await getSession();
  if (!pending || !session || pending.uid !== session.user.id) return done("m365=expired");
  if (url.searchParams.get("state") !== pending.state) return done("m365=expired");
  const error = url.searchParams.get("error");
  if (error) {
    // consent_required / access_denied: the tenant wants an administrator to approve the app's permissions first.
    const why = (url.searchParams.get("error_description") ?? error).split(/\r?\n/)[0]!.slice(0, 300);
    return done(`m365=error&reason=${encodeURIComponent(why)}`);
  }
  const code = url.searchParams.get("code");
  if (!code) return done("m365=expired");
  try {
    const t = await exchangeCode(m365Config(), code, pending.verifier);
    if (!t.refresh_token) return done(`m365=error&reason=${encodeURIComponent("Microsoft didn't return a refresh token; the app registration needs the offline_access permission.")}`);
    const me = await new GraphClient(async () => t.access_token).me();
    const account = { name: me.displayName, upn: me.userPrincipalName };
    await saveCredential(pending.connectorId, { refreshToken: t.refresh_token, account, savedAt: new Date().toISOString() }, session.user.id);
    forgetToken(pending.connectorId);
    const c = await db.connector.findUniqueOrThrow({ where: { id: pending.connectorId } });
    const config = { ...(c.config as Record<string, unknown>), account };
    const hasFolders = chosenFolders(config).length > 0;
    await db.connector.update({ where: { id: c.id }, data: {
      config, status: hasFolders ? "connected" : "action_required",
      statusNote: hasFolders ? null : `Signed in as ${account.name}. Choose the folders Synora should read.`, nextSyncAt: hasFolders ? new Date() : null,
    } });
    await db.auditEvent.create({ data: { actorId: session.user.id, action: "connector.m365-signin", target: c.name, detail: { connectorId: c.id, account: account.upn } } });
    return done("m365=connected");
  } catch (e) {
    return done(`m365=error&reason=${encodeURIComponent(e instanceof Error ? e.message.slice(0, 300) : "The sign-in failed.")}`);
  }
}
