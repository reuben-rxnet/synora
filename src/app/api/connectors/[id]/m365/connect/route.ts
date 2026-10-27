import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { authorizeUrl, m365Config, pkce } from "@/lib/connectors/m365/auth";
import { M365_COOKIE, M365_COOKIE_PATH, sealPending } from "@/lib/connectors/m365/state-cookie";

export const dynamic = "force-dynamic";

/** Starts the Microsoft 365 sign-in for a SharePoint & OneDrive connector (opened as a page, so it redirects). */
export async function GET(req: Request, ctx: RouteContext<"/api/connectors/[id]/m365/connect">) {
  const back = (q: string) => NextResponse.redirect(new URL(`/sources?${q}`, req.url));
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in?next=/sources", req.url));
  if (!session.permissions.has("connectors.manage")) return back("m365=forbidden");
  const { id } = await ctx.params;
  const c = await db.connector.findUnique({ where: { id } });
  if (!c || c.type !== "m365") return back("m365=missing");
  let cfg;
  try { cfg = m365Config(); } catch { return back("m365=not-configured"); }
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(cfg, state, challenge, session.user.email.endsWith("@demo.synora") ? undefined : session.user.email));
  res.cookies.set(M365_COOKIE, sealPending({ uid: session.user.id, connectorId: c.id, verifier, state, exp: Date.now() + 600_000 }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: M365_COOKIE_PATH, maxAge: 600,
  });
  return res;
}
