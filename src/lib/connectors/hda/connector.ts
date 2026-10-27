// HDA connector: solved and closed tickets of the activated owner groups become searchable records.
//   * Only tickets owned by the owner groups an administrator activated on the Sources page are requested.
//   * Incremental by the "solved at" date (C70C). Pages are read by date (keyset), not by a growing offset, so a
//     deep sync costs HDA the same per page as the first one.
//   * Each ticket type maps to a space (IT Support, HR, Retail…). HR types are restricted to the owner group.
//   * Sensitive types (security incidents, report leaks…) are never requested at all.
//   * The extended field mapping is split over several Projection calls so every URL stays short; an expression
//     HDA rejects is dropped (or replaced by its fallback) for the rest of the run instead of failing the sync.
//   * Projection truncates long text at ~500 characters, so truncated tickets are re-read with /WSC/Get.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { principal } from "@/lib/access";
import { ConnectorError, type ChangeBatch, type Connector, type SourceItem, type SyncContext, type TestResult } from "../types";
import { HdaClient, HdaError, stripHtml, toDate, type HdaOptions, type Projection } from "./client";

interface TypeRule { ids: string[]; label: string; recordType: SourceItem["recordType"]; space: string; visibility: "space" | "owner-group" | "space+owner-group"; sensitivity?: SourceItem["sensitivity"] }
/** One extended HDA field. "search" fields join the searchable text; "detail" and person fields are only shown. */
export interface FieldRule { key: string; expr: string; label: string; tier: "search" | "detail"; fallback?: string; person?: boolean }
export interface HdaMapping {
  entity: string; objectTypeProperty: string; statusProperty: string; ownerGroupProperty: string; solvedStatusIds: string[];
  cursorProperty: string; initialLookbackDays: number; pageSize: number; fetchFullText: boolean;
  requestDelayMs: number; maxUrlLength: number; membershipSyncHours: number;
  columns: Record<string, string>; fields: FieldRule[]; statusLabels: Record<string, string>; types: TypeRule[];
  neverIndex: { ids: string[] }; groups: { entity: string; id: string; name: string }; access: Record<string, string>; ticketUrl: string;
}
export interface OwnerGroup { id: string; name: string }

export function loadMapping(file = process.env.HDA_MAPPING_FILE || "config/hda-mapping.json"): HdaMapping {
  return JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as HdaMapping;
}

/** The owner groups activated on the connector. Nothing is synced until at least one is active. */
export const activeGroups = (config: Record<string, unknown>): OwnerGroup[] =>
  Array.isArray(config.ownerGroups) ? (config.ownerGroups as OwnerGroup[]).filter((g) => g && typeof g.id === "string") : [];

const clients = new Map<string, HdaClient>();
/** One client per connector, so its token and its lockout state survive between sync runs in the worker. */
export function hdaClient(ctx: Pick<SyncContext, "connectorId" | "config" | "secret">, requestDelayMs = loadMapping().requestDelayMs): HdaClient {
  let c = clients.get(ctx.connectorId);
  if (!c) {
    const cfg = ctx.config as { baseUrl?: string; authMode?: HdaOptions["authMode"]; username?: string };
    const baseUrl = cfg.baseUrl || process.env.HDA_BASE_URL;
    if (!baseUrl) throw new ConnectorError("NOT_CONFIGURED", "Set the HDA base URL on the connector or HDA_BASE_URL.");
    const mode = cfg.authMode || process.env.HDA_AUTH_MODE || "login";
    const username = cfg.username || process.env.HDA_USERNAME;
    // Don't send an empty sign-in: HDA counts it as a failed attempt.
    if (!username || (mode === "login" ? !ctx.secret("HDA_PASSWORD") : !ctx.secret("HDA_API_KEY"))) {
      throw new ConnectorError("NOT_CONFIGURED", `Set HDA_USERNAME and ${mode === "login" ? "HDA_PASSWORD" : "HDA_API_KEY"} in .env (the HDA API user), then test again.`);
    }
    c = new HdaClient({
      baseUrl, authMode: cfg.authMode || (process.env.HDA_AUTH_MODE as HdaOptions["authMode"]) || "login",
      username: cfg.username || process.env.HDA_USERNAME, password: ctx.secret("HDA_PASSWORD"), apiKey: ctx.secret("HDA_API_KEY"),
      sourceApplication: process.env.HDA_SOURCE_APPLICATION || "Synora", requestDelayMs,
    });
    clients.set(ctx.connectorId, c);
  }
  return c;
}

export function ruleFor(m: HdaMapping, objectType: string): TypeRule | null {
  if (m.neverIndex.ids.includes(objectType)) return null;
  return m.types.find((t) => t.ids.includes(objectType)) ?? null;
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== "" && v !== false;
/** HDA dates come as "/Date(ms)/" or ISO; booleans only matter when set. */
function display(v: unknown): string {
  if (v === true) return "Yes";
  if (typeof v === "string" && (/^\/Date\(/.test(v) || /^\d{4}-\d{2}-\d{2}T/.test(v))) return toDate(v)?.toISOString() ?? v;
  return typeof v === "string" ? stripHtml(v) : String(v);
}

/** Maps one Projection row to a Synora item, or null when the type isn't indexed. Exported for tests. */
export function toItem(row: Record<string, unknown>, m: HdaMapping, baseUrl: string): SourceItem | null {
  const s = (k: string) => (row[k] === undefined || row[k] === null || row[k] === "" ? null : String(row[k]));
  const rule = ruleFor(m, s("objectType") ?? "");
  const id = s("id");
  if (!rule || !id) return null;
  const description = stripHtml(row["description"]);
  const solution = stripHtml(row["solution"]);
  const groupId = s("ownerGroupId");
  const acl: string[] = [];
  if (groupId && rule.visibility !== "space") acl.push(principal.group(`hda:${groupId}`));

  const fields = (m.fields ?? []).filter((f) => filled(row[f.key])).map((f) => ({ key: f.key, label: f.label, value: display(row[f.key]), tier: f.tier, ...(f.person ? { person: true } : {}) }));
  // Names of people stay out of the searchable text, so they are never embedded or sent to the AI.
  const details = fields.filter((f) => f.tier === "search" && !f.person).map((f) => `${f.label}: ${f.value}`);
  const application = fields.find((f) => f.key.startsWith("applicationName"))?.value ?? null;
  const parent = fields.find((f) => f.key === "parentTicket")?.value;
  const mentions = [...new Set((`${description}\n${solution}`).match(/\b(?:BUG|WI)-\d+\b/g) ?? [])].map((ref) => ({ ref, kind: "mentions" as const }));

  return {
    externalId: id, ref: id, sourceSystem: "HDA Ticketing", recordType: rule.recordType, title: s("subject") ?? `${rule.label} ${id}`,
    body: [description, solution ? `Solution:\n${solution}` : "", details.length ? `Details:\n${details.join("\n")}` : ""].filter(Boolean).join("\n\n"),
    evidenceKind: "historical", approval: "historical", application,
    category: s("category"), ownerGroup: s("ownerGroupName"), priority: s("priority"), location: s("location"),
    status: m.statusLabels[s("status") ?? ""] ?? s("status"), resolution: solution || null,
    rootCause: s("resolutionType"), createdAt: toDate(row["openedAt"]), updatedAt: toDate(row["solvedAt"]),
    sourceUrl: m.ticketUrl.replace("{base}", baseUrl.replace(/\/+$/, "")).replace("{id}", encodeURIComponent(id)),
    spaceKey: rule.space, sensitivity: rule.sensitivity ?? "internal",
    // "owner-group" types are visible to the owner group only; ingest adds the space for the others.
    acl: rule.sensitivity === "restricted" && !acl.length ? [principal.group("hda:__nobody__")] : acl,
    links: [...(parent && parent !== id ? [{ ref: parent, kind: "parent" as const }] : []), ...mentions],
    raw: { objectType: s("objectType"), source: s("source"), ticketOwner: s("ticketOwner"), ownerGroupId: groupId, fields },
  };
}

const TRUNCATED = 495;
/** Columns a usable record can't do without. The rest of the mapping may be blank on any given ticket. */
export const REQUIRED_COLUMNS = ["id", "subject", "description", "objectType", "status", "solvedAt"];

/**
 * Which expression each extended field uses, per client: rejected expressions are swapped for their fallback or
 * dropped, once, and remembered for the life of the worker so the next pages don't pay for it again.
 */
const plans = new WeakMap<HdaClient, Map<string, string | null>>();
function planFor(client: HdaClient, m: HdaMapping) {
  let p = plans.get(client);
  if (!p) { p = new Map((m.fields ?? []).map((f) => [f.key, f.expr])); plans.set(client, p); }
  return p;
}

type Query = Omit<Projection, "columns" | "names">;
// Only an HDA API error (JSON with a result code) says a column is wrong; an error page is HDA being unavailable.
const isRejection = (e: unknown) => e instanceof HdaError && !e.info.authBlocked && e.info.result !== undefined;

/**
 * Reads every mapped column for one page: the core columns in one call, the extended fields in further calls
 * sized to stay under maxUrlLength, merged by ticket id. `dropped` collects field labels HDA wouldn't accept.
 */
export async function fetchRows(client: HdaClient, m: HdaMapping, q: Query, dropped: Set<string> = new Set()): Promise<Record<string, unknown>[]> {
  const core = Object.keys(m.columns);
  const base = await client.projection({ ...q, columns: core.map((k) => m.columns[k]!), names: core });
  const rows = Array.isArray(base.data) ? (base.data as Record<string, unknown>[]) : [];
  if (!rows.length) return rows;
  const byId = new Map(rows.map((r) => [String(r["id"]), r]));
  const plan = planFor(client, m);
  const rules = new Map((m.fields ?? []).map((f) => [f.key, f]));

  const run = async (keys: string[]): Promise<void> => {
    if (!keys.length) return;
    try {
      const res = await client.projection({ ...q, columns: ["ID", ...keys.map((k) => plan.get(k)!)], names: ["id", ...keys] });
      for (const r of Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []) {
        const target = byId.get(String(r["id"]));
        if (target) for (const k of keys) target[k] = r[k];
      }
    } catch (e) {
      if (!isRejection(e)) throw e;
      if (keys.length > 1) { const mid = Math.ceil(keys.length / 2); await run(keys.slice(0, mid)); await run(keys.slice(mid)); return; }
      const f = rules.get(keys[0]!)!;
      const next = plan.get(f.key) !== f.fallback && f.fallback ? f.fallback : null;
      plan.set(f.key, next);
      if (next) await run(keys); else dropped.add(`${f.label} (${f.expr})`);
    }
  };

  // Greedy split: add fields to a call while its URL stays under the limit.
  let chunk: string[] = [];
  const chunks: string[][] = [];
  for (const key of [...plan.keys()].filter((k) => plan.get(k))) {
    const next = [...chunk, key];
    if (chunk.length && client.projectionUrlLength({ ...q, columns: ["ID", ...next.map((k) => plan.get(k)!)], names: ["id", ...next] }) > m.maxUrlLength) {
      chunks.push(chunk); chunk = [key];
    } else chunk = next;
  }
  if (chunk.length) chunks.push(chunk);
  for (const c of chunks) await run(c);
  return rows;
}

/**
 * Where the next keyset page starts. The query asks for rows solved after `since` minus one second, so `skip`
 * counts the rows of that last second already read. A page that didn't move the date forward only adds to skip.
 */
export function nextPage(since: Date, skip: number, rows: Record<string, unknown>[]): { since: Date; skip: number } {
  const last = rows.length ? toDate(rows[rows.length - 1]!["solvedAt"]) : null;
  if (!last || last.getTime() <= since.getTime()) return { since, skip: skip + rows.length };
  return { since: last, skip: rows.filter((r) => (toDate(r["solvedAt"])?.getTime() ?? 0) > last.getTime() - 1000).length };
}

/** Splits the active owner groups so the group filter never pushes a URL past the limit. */
function groupBatches(groups: OwnerGroup[], maxChars = 400): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const g of groups) {
    if (cur.length && JSON.stringify([...cur, g.id]).length > maxChars) { out.push(cur); cur = []; }
    cur.push(g.id);
  }
  if (cur.length) out.push(cur);
  return out;
}

const NO_GROUPS = "Activate at least one HDA owner group (Sources → HDA → Owner groups) before syncing.";

const groupCache = new Map<string, { at: number; groups: OwnerGroup[] }>();
/** All HDA user groups, read once an hour at most and searched locally, so typing in the search box costs HDA nothing. */
export async function searchOwnerGroups(ctx: Pick<SyncContext, "connectorId" | "config" | "secret">, q: string, limit = 50): Promise<OwnerGroup[]> {
  const m = loadMapping();
  let cached = groupCache.get(ctx.connectorId);
  if (!cached || Date.now() - cached.at > 3600_000) {
    const client = hdaClient(ctx, m.requestDelayMs);
    const groups: OwnerGroup[] = [];
    for (let start = 0; start < 20_000; start += 500) {
      const res = await client.projection({ entity: m.groups.entity, columns: [m.groups.id, m.groups.name], names: ["id", "name"], start, limit: 500, sort: [{ property: m.groups.name, direction: "ASC" }] });
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      for (const r of rows) if (r["id"]) groups.push({ id: String(r["id"]), name: String(r["name"] ?? r["id"]) });
      if (rows.length < 500) break;
    }
    cached = { at: Date.now(), groups };
    groupCache.set(ctx.connectorId, cached);
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return cached.groups.filter((g) => words.every((w) => `${g.name} ${g.id}`.toLowerCase().includes(w))).slice(0, limit);
}

export const hdaConnector: Connector = {
  type: "hda",
  label: "HDA Ticketing",
  get membershipSyncHours() { return loadMapping().membershipSyncHours; },

  async testConnection(ctx): Promise<TestResult> {
    const m = loadMapping();
    try {
      clients.delete(ctx.connectorId); // a test always uses the current settings
      const client = hdaClient(ctx, m.requestDelayMs);
      const groups = activeGroups(ctx.config);
      const dropped = new Set<string>();
      const rows = await fetchRows(client, m, {
        entity: m.entity, limit: 5, sort: [{ property: m.cursorProperty, direction: "DESC" }],
        filter: [{ property: m.statusProperty, op: "in", value: m.solvedStatusIds }, ...(groups.length ? [{ property: m.ownerGroupProperty, op: "in", value: groupBatches(groups)[0] }] : [])],
      }, dropped);
      const scope = groups.length ? ` for ${groups.length} active owner group${groups.length > 1 ? "s" : ""}` : "";
      if (!rows.length) return { ok: true, level: "warn", message: `Connected, but no solved tickets were returned${scope}. ${groups.length ? "Check the owner groups and" : "Check"} the status IDs in config/hda-mapping.json.` };
      const empty = REQUIRED_COLUMNS.filter((k) => rows.every((r) => !filled(r[k])));
      const extended = (m.fields ?? []).filter((f) => rows.some((r) => filled(r[f.key]))).length;
      const notes = [
        `${rows.length} recent solved tickets read${scope}; ${extended} of ${(m.fields ?? []).length} extended fields filled on them.`,
        dropped.size ? `HDA rejected ${dropped.size} field expression${dropped.size > 1 ? "s" : ""}, skipped: ${[...dropped].join(", ")}.` : "",
        groups.length ? "" : NO_GROUPS,
      ].filter(Boolean).join(" ");
      if (empty.length) return { ok: true, level: "warn", message: `Connected. These required fields came back empty: ${empty.join(", ")}. Run npm run hda:discover and fix config/hda-mapping.json. ${notes}`, sample: rows.length };
      return { ok: true, level: dropped.size || !groups.length ? "warn" : "ok", message: `Connected. ${notes}`, sample: rows.length };
    } catch (e) {
      return { ok: false, level: "error", message: e instanceof HdaError || e instanceof ConnectorError ? e.message : "The connection test failed." };
    }
  },

  async *fetchChanges(ctx, cursor): AsyncGenerator<ChangeBatch> {
    const m = loadMapping();
    const groups = activeGroups(ctx.config);
    if (!groups.length) throw new ConnectorError("SETUP", NO_GROUPS);
    const client = hdaClient(ctx, m.requestDelayMs);
    const baseUrl = (ctx.config as { baseUrl?: string }).baseUrl || process.env.HDA_BASE_URL || "";
    const start = cursor ? new Date(cursor) : new Date(Date.now() - m.initialLookbackDays * 864e5);
    const objectTypes = m.types.flatMap((t) => t.ids);
    const batches = groupBatches(groups);
    const dropped = new Set<string>();
    let finalCursor: Date | null = null;

    for (const [b, groupIds] of batches.entries()) {
      // Keyset paging: everything solved after `since`, oldest first. HDA dates are second-precision, so the
      // filter starts one second early and `skip` steps over the rows already read in that last second.
      let since = start;
      let skip = 0;
      for (;;) {
        const lower = new Date(since.getTime() - 1000);
        let rows: Record<string, unknown>[];
        try {
          rows = await fetchRows(client, m, {
            entity: m.entity, start: skip, limit: m.pageSize,
            filter: [
              { property: m.statusProperty, op: "in", value: m.solvedStatusIds },
              { property: m.cursorProperty, op: "gt", value: lower.toISOString() },
              { property: m.objectTypeProperty, op: "in", value: objectTypes },
              { property: m.ownerGroupProperty, op: "in", value: groupIds },
            ],
            sort: [{ property: m.cursorProperty, direction: "ASC" }, { property: "ID", direction: "ASC" }],
          }, dropped);
        } catch (e) {
          if (e instanceof HdaError) {
            const code = e.info.authBlocked || e.info.path?.startsWith("/Authentication") ? "AUTH" : e.info.result !== undefined ? "REJECTED" : "UNREACHABLE";
            throw new ConnectorError(code, e.message, code === "UNREACHABLE");
          }
          throw e;
        }

        const items: SourceItem[] = [];
        for (const row of rows) {
          if (m.fetchFullText && [row["description"], row["solution"]].some((v) => typeof v === "string" && v.length >= TRUNCATED)) {
            try {
              const full = await client.get(m.entity, String(row["id"]));
              const d = (full.data ?? {}) as Record<string, unknown>;
              row["description"] = d[m.columns.description!] ?? row["description"];
              row["solution"] = d[m.columns.solution!] ?? row["solution"];
            } catch { ctx.log(`Kept the shortened text for ${String(row["id"])}: the full ticket could not be read.`); }
          }
          const item = toItem(row, m, baseUrl);
          if (item) items.push(item);
        }

        ({ since, skip } = nextPage(since, skip, rows));
        // With several group batches, only the last one may move the saved cursor forward mid-run.
        yield { items, cursor: (b === batches.length - 1 ? since : start).toISOString(), done: false };
        if (rows.length < m.pageSize) break;
      }
      if (!finalCursor || since < finalCursor) finalCursor = since;
    }
    if (dropped.size) ctx.log(`HDA rejected these field expressions, so they were skipped: ${[...dropped].join(", ")}. Fix them in config/hda-mapping.json.`);
    yield { items: [], cursor: (finalCursor ?? start).toISOString(), done: true };
  },

  async fetchMemberships(ctx) {
    const m = loadMapping();
    const a = m.access;
    const client = hdaClient(ctx, m.requestDelayMs);
    const active = activeGroups(ctx.config);
    const keys = ["username", "upn", "groupId", "groupName"];
    const groups = new Map<string, { groupName: string; logins: Set<string> }>(active.map((g) => [g.id, { groupName: g.name, logins: new Set<string>() }]));
    // Only the activated groups: their members are the people who may see restricted tickets.
    for (const ids of groupBatches(active)) {
      for (let start = 0; start < 50_000; start += 500) {
        const res = await client.projection({ entity: a.entity!, columns: keys.map((k) => a[k]!), names: keys, start, limit: 500, filter: [{ property: a.groupId!, op: "in", value: ids }] });
        const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
        for (const r of rows) {
          if (!r["groupId"]) continue;
          const g = groups.get(String(r["groupId"])) ?? { groupName: String(r["groupName"] ?? r["groupId"]), logins: new Set<string>() };
          for (const login of [r["upn"], r["username"]]) if (typeof login === "string" && login.trim()) g.logins.add(login.trim().toLowerCase());
          groups.set(String(r["groupId"]), g);
        }
        if (rows.length < 500) break;
      }
    }
    return [...groups].map(([id, g]) => ({ groupKey: `hda:${id}`, groupName: g.groupName, memberLogins: [...g.logins] }));
  },
};
