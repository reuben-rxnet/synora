"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { DEMO_PERSONAS, isDemoAuthEnabled, SESSION_COOKIE } from "@/lib/auth/demo";
import { SESSION_HOURS, signSession } from "@/lib/auth/session-cookie";

/** Demo sign-in. Refused unless demo auth is on, and only for the listed fictional personas. */
export async function signInAsPersona(form: FormData) {
  if (!isDemoAuthEnabled()) redirect("/sign-in");
  const email = String(form.get("email") ?? "");
  const next = String(form.get("next") ?? "/");
  if (!DEMO_PERSONAS.some((p) => p.email === email)) redirect("/sign-in?error=persona");
  const user = await db.user.findUnique({ where: { email } });
  if (!user) redirect("/sign-in?error=persona");
  await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
  await db.auditEvent.create({ data: { actorId: user.id, action: "auth.signed-in", target: user.email, detail: { via: "demo" } } });
  (await cookies()).set(SESSION_COOKIE, signSession({ uid: user.id, via: "demo", exp: Date.now() + SESSION_HOURS * 3_600_000 }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
