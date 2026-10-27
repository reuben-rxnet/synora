import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { AuthorizationError, parseRoles, permissionsFor, principalsFor, type Permission, type Role } from "@/lib/access";
import { isDemoAuthEnabled, SESSION_COOKIE } from "./demo";
import { isEntraEnabled } from "./entra-config";
import { verifySession } from "./session-cookie";

export interface Session {
  user: { id: string; email: string; displayName: string; initials: string; jobTitle: string; department: string };
  roles: Role[];
  permissions: Set<Permission>;
  spaces: { id: string; key: string; name: string; role: string }[];
  groupKeys: string[];
  /** Principal keys used to filter records. Computed on the server only, never taken from the request. */
  principals: string[];
}

export class AuthError extends Error {
  readonly code = "UNAUTHENTICATED";
}

export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  if (token.via === "demo" && !isDemoAuthEnabled()) return null;
  if (token.via === "entra" && !isEntraEnabled()) return null;

  const user = await db.user.findUnique({
    where: { id: token.uid },
    include: { spaces: { include: { space: true } }, groups: { include: { group: true } } },
  });
  if (!user || !user.active) return null;

  const roles = parseRoles(user.roles);
  // Every signed-in person can search every space that isn't restricted; restricted spaces (HR) need a membership.
  // Records with their own source permissions (restricted HR cases) stay limited to those principals either way.
  const joined = user.spaces.map((m) => ({ id: m.space.id, key: m.space.key, name: m.space.name, role: m.role }));
  const open = await db.space.findMany({ where: { visibility: { not: "restricted" }, id: { notIn: joined.map((s) => s.id) } }, orderBy: { name: "asc" } });
  const spaces = [...joined, ...open.map((s) => ({ id: s.id, key: s.key, name: s.name, role: "member" }))];
  const groupKeys = user.groups.map((g) => g.group.key);
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, initials: user.initials, jobTitle: user.jobTitle, department: user.department },
    roles,
    permissions: permissionsFor(roles),
    spaces,
    groupKeys,
    principals: principalsFor({ userId: user.id, spaceIds: spaces.map((s) => s.id), groupKeys }),
  };
});

export async function requirePageSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/sign-in");
  return s;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError("Your session has ended. Sign in again to continue.");
  return s;
}

export function assertPermission(session: Session, permission: Permission): void {
  if (!session.permissions.has(permission)) throw new AuthorizationError(permission);
}
