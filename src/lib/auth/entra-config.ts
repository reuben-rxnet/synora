import { z } from "zod";
import { ROLES, type Role } from "@/lib/access";

/**
 * Microsoft Entra ID (OIDC, authorization code + PKCE), configured from the environment:
 *   AUTH_PROVIDER=entra, ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET (Key Vault in production), APP_BASE_URL
 *
 * Access comes only from the ID token:
 *   * app roles (the "roles" claim): "role.<global role>" (e.g. role.support-engineer) and
 *     "space.<space key>.<member|editor|owner>" (e.g. space.hr.member);
 *   * security groups (the "groups" claim) are stored as group principals "entra:<object id>", so
 *     SharePoint and Outlook permissions that name Entra groups match.
 * Nothing in a request can grant a role or a space.
 */
export const isEntraEnabled = (env: Record<string, string | undefined> = process.env) => env.AUTH_PROVIDER === "entra";

export interface EntraConfig { tenantId: string; clientId: string; clientSecret: string; baseUrl: string; issuer: string; redirectUri: string }

export function loadEntraConfig(env: Record<string, string | undefined> = process.env): EntraConfig {
  const v = z.object({
    ENTRA_TENANT_ID: z.guid("ENTRA_TENANT_ID must be the tenant's GUID."),
    ENTRA_CLIENT_ID: z.guid("ENTRA_CLIENT_ID must be the app registration's GUID."),
    ENTRA_CLIENT_SECRET: z.string().min(10, "ENTRA_CLIENT_SECRET is required."),
    APP_BASE_URL: z.string().url("APP_BASE_URL must be the app's public URL."),
  }).parse(Object.fromEntries(Object.entries(env).filter(([, x]) => x !== undefined && x.trim() !== "")));
  const base = v.APP_BASE_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production" && !base.startsWith("https://")) throw new Error("APP_BASE_URL must use https in production.");
  return {
    tenantId: v.ENTRA_TENANT_ID, clientId: v.ENTRA_CLIENT_ID, clientSecret: v.ENTRA_CLIENT_SECRET, baseUrl: base,
    issuer: `https://login.microsoftonline.com/${v.ENTRA_TENANT_ID}/v2.0`, redirectUri: `${base}/api/auth/callback`,
  };
}

export interface Grants { roles: Set<Role>; spaces: Map<string, "member" | "editor" | "owner"> }

const SPACE_ROLE_RANK = { member: 1, editor: 2, owner: 3 } as const;

/** Reads app-role values. Unknown values grant nothing. */
export function grantsFromAppRoles(values: readonly string[]): Grants {
  const roles = new Set<Role>();
  const spaces = new Map<string, "member" | "editor" | "owner">();
  for (const v of values) {
    const role = /^role\.([a-z-]+)$/.exec(v)?.[1];
    if (role && (ROLES as readonly string[]).includes(role)) { roles.add(role as Role); continue; }
    const m = /^space\.([a-z0-9-]+)\.(member|editor|owner)$/.exec(v);
    if (m) {
      const [, key, r] = m as unknown as [string, string, "member" | "editor" | "owner"];
      const cur = spaces.get(key);
      if (!cur || SPACE_ROLE_RANK[r] > SPACE_ROLE_RANK[cur]) spaces.set(key, r);
    }
  }
  if (spaces.size && !roles.size) roles.add("search-user");
  return { roles, spaces };
}
