// Roles, permissions and the principal keys used in record permissions.
//
// Two separate things decide what a person may do:
//   * global ROLES decide which features they can use (configure connectors, approve knowledge…);
//   * PRINCIPALS (their user id, groups and spaces) decide which records they can see.
// An administrator can configure everything but still sees only records their principals allow.

export const ROLES = ["search-user", "support-engineer", "connector-owner", "knowledge-manager", "administrator", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  "search-user": "Search User",
  "support-engineer": "Support Engineer",
  "connector-owner": "Connector Owner",
  "knowledge-manager": "Knowledge Manager",
  administrator: "Administrator",
  auditor: "Auditor",
};

export type Permission =
  | "search"
  | "investigate"
  | "save"
  | "connectors.view"
  | "connectors.manage"
  | "knowledge.review"
  | "admin.view"
  | "admin.manage"
  | "audit.view";

const GRANTS: Record<Role, Permission[]> = {
  "search-user": ["search", "save"],
  "support-engineer": ["search", "save", "investigate"],
  "connector-owner": ["search", "save", "connectors.view", "connectors.manage"],
  "knowledge-manager": ["search", "save", "investigate", "knowledge.review"],
  administrator: ["search", "save", "investigate", "connectors.view", "connectors.manage", "knowledge.review", "admin.view", "admin.manage", "audit.view"],
  auditor: ["search", "admin.view", "audit.view", "connectors.view"],
};

export function parseRoles(csv: string): Role[] {
  return csv.split(",").map((r) => r.trim()).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
}

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((r) => GRANTS[r]));
}

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";
  constructor(readonly permission: Permission) {
    super(`You don't have permission for this (${permission}).`);
  }
}

/** Principal keys stored in SourceRecord.acl. */
export const principal = {
  everyone: "everyone",
  user: (id: string) => `user:${id}`,
  space: (id: string) => `space:${id}`,
  group: (key: string) => `group:${key}`,
};

/** Every key a person matches. A record is visible when its acl shares at least one key with this list. */
export function principalsFor(p: { userId: string; spaceIds: readonly string[]; groupKeys: readonly string[] }): string[] {
  return [principal.everyone, principal.user(p.userId), ...p.spaceIds.map(principal.space), ...p.groupKeys.map(principal.group)];
}

export function canSee(acl: readonly string[], principals: readonly string[]): boolean {
  const mine = new Set(principals);
  return acl.some((k) => mine.has(k));
}
