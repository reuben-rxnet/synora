import "server-only";
import * as oidc from "openid-client";
import { db } from "@/lib/db";
import { grantsFromAppRoles, loadEntraConfig, type EntraConfig } from "./entra-config";

let cached: { cfg: EntraConfig; server: Promise<oidc.Configuration> } | null = null;

/** OIDC client discovered from the tenant metadata. ENTRA_ISSUER_OVERRIDE (tests only) is ignored in production. */
export function entra() {
  if (!cached) {
    const cfg = loadEntraConfig();
    const override = process.env.NODE_ENV !== "production" ? process.env.ENTRA_ISSUER_OVERRIDE?.trim() : undefined;
    const issuer = new URL(override || cfg.issuer);
    const server = oidc.discovery(issuer, cfg.clientId, cfg.clientSecret, undefined, issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined);
    cached = { cfg: override ? { ...cfg, issuer: issuer.href.replace(/\/$/, "") } : cfg, server };
    server.catch(() => { cached = null; });
  }
  return cached;
}

export interface EntraIdentity { oid: string; email: string; name: string; groups: string[]; appRoles: string[] }

export function identityFrom(claims: Record<string, unknown>, cfg: EntraConfig): EntraIdentity {
  const str = (k: string) => (typeof claims[k] === "string" ? (claims[k] as string) : "");
  if (str("tid") !== cfg.tenantId) throw new Error("This account belongs to another organization.");
  if (claims["_claim_names"] && !Array.isArray(claims["groups"])) throw new Error("Your account is in too many groups to read from the sign-in token.");
  const oid = str("oid") || str("sub");
  const email = (str("email") || str("preferred_username")).toLowerCase();
  if (!oid || !email) throw new Error("The sign-in token is missing the account's id or email.");
  const list = (k: string) => (Array.isArray(claims[k]) ? (claims[k] as unknown[]).filter((g): g is string => typeof g === "string") : []);
  return { oid, email, name: str("name") || email, groups: list("groups"), appRoles: list("roles") };
}

/**
 * Creates or updates the user and syncs roles, spaces and Entra groups to the current token:
 * access removed in Entra is removed here at the next sign-in. Returns null when nothing grants access.
 */
export async function provisionUser(id: EntraIdentity) {
  const grants = grantsFromAppRoles(id.appRoles);
  if (!grants.roles.size) return null;
  const initials = id.name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join("") || "?";
  const existing = await db.user.findFirst({ where: { OR: [{ entraOid: id.oid }, { email: id.email }] } });
  const data = { entraOid: id.oid, email: id.email, displayName: id.name, initials, roles: [...grants.roles].join(","), lastSeenAt: new Date(), hdaUsername: id.email.split("@")[0] ?? null };
  const user = existing ? await db.user.update({ where: { id: existing.id }, data }) : await db.user.create({ data });

  const spaces = await db.space.findMany({ where: { key: { in: [...grants.spaces.keys()] } } });
  const groups = await Promise.all(id.groups.map((oid) => db.group.upsert({ where: { key: `entra:${oid}` }, update: { syncedAt: new Date() }, create: { key: `entra:${oid}`, name: oid, source: "entra" } })));
  await db.$transaction([
    db.spaceMember.deleteMany({ where: { userId: user.id, spaceId: { notIn: spaces.map((s) => s.id) } } }),
    ...spaces.map((s) => db.spaceMember.upsert({ where: { spaceId_userId: { spaceId: s.id, userId: user.id } }, update: { role: grants.spaces.get(s.key)! }, create: { spaceId: s.id, userId: user.id, role: grants.spaces.get(s.key)! } })),
    // Only Entra groups are synced here; HDA owner groups are synced by the HDA connector.
    db.userGroup.deleteMany({ where: { userId: user.id, group: { source: "entra" }, groupId: { notIn: groups.map((g) => g.id) } } }),
    ...groups.map((g) => db.userGroup.upsert({ where: { userId_groupId: { userId: user.id, groupId: g.id } }, update: {}, create: { userId: user.id, groupId: g.id } })),
  ]);
  return user;
}
