// HDA connector: solved and closed tickets become searchable records.
//   * Incremental by the "solved at" date (C70C), the property CSAT Pulse verified against QA. Solved tickets
//     carry the resolution, which is what Synora's answers need.
//   * Each ticket type maps to a space (IT Support, HR, Retail…). HR types are restricted to the owner group.
//   * Sensitive types (security incidents, report leaks…) are never requested at all.
//   * Projection truncates long text at ~500 characters, so truncated tickets are re-read with /WSC/Get.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { principal } from "@/lib/access";
import { ConnectorError, type ChangeBatch, type Connector, type SourceItem, type SyncContext, type TestResult } from "../types";
import { HdaClient, HdaError, stripHtml, toDate, type HdaOptions } from "./client";

interface TypeRule { ids: string[]; label: string; recordType: SourceItem["recordType"]; space: string; visibility: "space" | "owner-group" | "space+owner-group"; sensitivity?: SourceItem["sensitivity"] }
export interface HdaMapping {
  entity: string; objectTypeProperty: string; statusProperty: string; solvedStatusIds: string[];
  cursorProperty: string; cursorOperator: string; initialLookbackDays: number; pageSize: number; fetchFullText: boolean;
  columns: Record<string, string>; statusLabels: Record<string, string>; types: TypeRule[];
  neverIndex: { ids: string[] }; access: Record<string, string>; ticketUrl: string;
}

export function loadMapping(file = process.env.HDA_MAPPING_FILE || "config/hda-mapping.json"): HdaMapping {
  return JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as HdaMapping;
}

const clients = new Map<string, HdaClient>();
/** One client per connector, so its token and its lockout state survive between sync runs in the worker. */
export function hdaClient(ctx: Pick<SyncContext, "connectorId" | "config" | "secret">): HdaClient {
  let c = clients.get(ctx.connectorId);
  if (!c) {
    const cfg = ctx.config as { baseUrl?: string; authMode?: HdaOptions["authMode"]; username?: string };
    const baseUrl = cfg.baseUrl || process.env.HDA_BASE_URL;
    if (!baseUrl) throw new ConnectorError("NOT_CONFIGURED", "Set the HDA base URL on the connector or HDA_BASE_URL.");
    const mode = cfg.authMode || process.env.HDA_AUTH_MODE || "login";
    const username = cfg.username || process.env.HDA_USERNAME;
    // Don't send an empty sign-in: HDA counts it as a failed attempt.
    if (!username || (mode === "login" ? !ctx.secret("HDA_PASSWORD") : !ctx.secret("HDA_API_KEY"))) {
      throw new ConnectorError("NOT_CONFIGURED", `Set HDA_USERNAME and ${mode === "login" ? "HDA_PASSWORD" : "HDA_API_KEY"} in .env (the HDA API user, as in CSAT Pulse), then test again.`);
    }
    c = new HdaClient({
      baseUrl, authMode: cfg.authMode || (process.env.HDA_AUTH_MODE as HdaOptions["authMode"]) || "login",
      username: cfg.username || process.env.HDA_USERNAME, password: ctx.secret("HDA_PASSWORD"), apiKey: ctx.secret("HDA_API_KEY"),
      sourceApplication: process.env.HDA_SOURCE_APPLICATION || "Synora",
    });
    clients.set(ctx.connectorId, c);
  }
  return c;
}

export function ruleFor(m: HdaMapping, objectType: string): TypeRule | null {
  if (m.neverIndex.ids.includes(objectType)) return null;
  return m.types.find((t) => t.ids.includes(objectType)) ?? null;
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
  return {
    externalId: id, ref: id, sourceSystem: "HDA Ticketing", recordType: rule.recordType, title: s("subject") ?? `${rule.label} ${id}`,
    body: [description, solution ? `Solution:\n${solution}` : ""].filter(Boolean).join("\n\n"),
    evidenceKind: "historical", approval: "historical",
    category: s("category"), ownerGroup: s("ownerGroupName"), priority: s("priority"), location: s("location"),
    status: m.statusLabels[s("status") ?? ""] ?? s("status"), resolution: solution || null,
    rootCause: s("resolutionType"), createdAt: toDate(row["openedAt"]), updatedAt: toDate(row["solvedAt"]),
    sourceUrl: m.ticketUrl.replace("{base}", baseUrl.replace(/\/+$/, "")).replace("{id}", encodeURIComponent(id)),
    spaceKey: rule.space, sensitivity: rule.sensitivity ?? "internal",
    // "owner-group" types are visible to the owner group only; ingest adds the space for the others.
    acl: rule.sensitivity === "restricted" && !acl.length ? [principal.group("hda:__nobody__")] : acl,
    links: [...new Set((`${description}\n${solution}`).match(/\b(?:BUG|WI)-\d+\b/g) ?? [])].map((ref) => ({ ref, kind: "mentions" as const })),
    raw: { objectType: s("objectType"), source: s("source"), ticketOwner: s("ticketOwner") },
  };
}

const TRUNCATED = 495;

export const hdaConnector: Connector = {
  type: "hda",
  label: "HDA Ticketing",

  async testConnection(ctx): Promise<TestResult> {
    const m = loadMapping();
    try {
      clients.delete(ctx.connectorId); // a test always uses the current settings
      const client = hdaClient(ctx);
      const keys = Object.keys(m.columns);
      const res = await client.projection({ entity: m.entity, columns: keys.map((k) => m.columns[k]!), names: keys, limit: 5,
        filter: [{ property: m.statusProperty, op: "eq", value: m.solvedStatusIds[0] }], sort: [{ property: m.cursorProperty, direction: "DESC" }] });
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      const empty = keys.filter((k) => rows.length && rows.every((r) => r[k] === null || r[k] === undefined || r[k] === ""));
      if (!rows.length) return { ok: true, level: "warn", message: "Connected, but no solved tickets were returned. Check the status IDs in config/hda-mapping.json." };
      if (empty.length) return { ok: true, level: "warn", message: `Connected. These fields came back empty: ${empty.join(", ")}. Run npm run hda:discover and fix config/hda-mapping.json.`, sample: rows.length };
      return { ok: true, level: "ok", message: `Connected. ${rows.length} recent solved tickets read; every mapped field is filled.`, sample: rows.length };
    } catch (e) {
      return { ok: false, level: "error", message: e instanceof HdaError || e instanceof ConnectorError ? e.message : "The connection test failed." };
    }
  },

  async *fetchChanges(ctx, cursor): AsyncGenerator<ChangeBatch> {
    const m = loadMapping();
    const client = hdaClient(ctx);
    const baseUrl = (ctx.config as { baseUrl?: string }).baseUrl || process.env.HDA_BASE_URL || "";
    const since = cursor ? new Date(cursor) : new Date(Date.now() - m.initialLookbackDays * 864e5);
    const keys = Object.keys(m.columns);
    const objectTypes = m.types.flatMap((t) => t.ids);
    let watermark = since;

    for (const statusId of m.solvedStatusIds) {
      for (let start = 0; ; start += m.pageSize) {
        let res;
        try {
          res = await client.projection({
            entity: m.entity, columns: keys.map((k) => m.columns[k]!), names: keys, start, limit: m.pageSize,
            filter: [
              { property: m.statusProperty, op: "eq", value: statusId },
              { property: m.cursorProperty, op: m.cursorOperator, value: since.toISOString() },
              { property: m.objectTypeProperty, op: "in", value: objectTypes },
            ],
            sort: [{ property: m.cursorProperty, direction: "ASC" }],
          });
        } catch (e) {
          if (e instanceof HdaError) throw new ConnectorError(e.info.authBlocked || e.info.result ? "AUTH" : "UNREACHABLE", e.message, !e.info.authBlocked && !e.info.result);
          throw e;
        }
        const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
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
          const at = toDate(row["solvedAt"]);
          if (at && at > watermark) watermark = at;
        }
        const last = rows.length < m.pageSize || (res.total !== undefined && start + m.pageSize >= res.total);
        yield { items, cursor: watermark.toISOString(), done: false };
        if (last) break;
      }
    }
    yield { items: [], cursor: watermark.toISOString(), done: true };
  },

  async fetchMemberships(ctx) {
    const m = loadMapping();
    const a = m.access;
    const client = hdaClient(ctx);
    const keys = ["username", "upn", "groupId", "groupName"];
    const groups = new Map<string, { groupName: string; logins: Set<string> }>();
    for (let start = 0; start < 50_000; start += 500) {
      const res = await client.projection({ entity: a.entity!, columns: keys.map((k) => a[k]!), names: keys, start, limit: 500 });
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      for (const r of rows) {
        if (!r["groupId"]) continue;
        const g = groups.get(String(r["groupId"])) ?? { groupName: String(r["groupName"] ?? r["groupId"]), logins: new Set<string>() };
        for (const login of [r["upn"], r["username"]]) if (typeof login === "string" && login.trim()) g.logins.add(login.trim().toLowerCase());
        groups.set(String(r["groupId"]), g);
      }
      if (rows.length < 500) break;
    }
    return [...groups].map(([id, g]) => ({ groupKey: `hda:${id}`, groupName: g.groupName, memberLogins: [...g.logins] }));
  },
};
