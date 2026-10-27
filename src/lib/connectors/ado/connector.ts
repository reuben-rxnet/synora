// Azure DevOps connector: the work items of one project become searchable development records.
//   * Incremental by System.ChangedDate with keyset paging (changed date, then id), so a large project costs the
//     same per page from the first page to the last. One WIQL call and one batch call per 200 work items.
//   * Every field Azure DevOps reports is mapped (see config/ado-mapping.json); people are shown by display name
//     only and never become searchable text. Comments join the content as a Discussion section, without authors.
//   * Parent, related and duplicate links become record links; HDA ticket numbers in the text link to the tickets.
//   * Work items in the recycle bin are removed from Synora on every sync.
//   * The project's wikis are indexed as documents, so answers can draw on the team's documentation. Each sync
//     reads the page tree once (new pages are read at once, removed pages leave Synora) and re-reads a capped
//     number of known pages that haven't been checked for `refreshHours`; a page is stored again only when its
//     version changed. Only the Wiki (Read) scope is needed, never access to source code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConnectorError, type ChangeBatch, type Connector, type SourceItem, type SyncContext, type TestResult } from "../types";
import { stripHtml, toDate } from "../hda/client";
import { datePosition } from "../progress";
import { AdoClient, AdoError, type AdoField, type AdoOptions, type AdoWiki, type AdoWikiPage, type AdoWorkItem } from "./client";

export interface AdoMapping {
  initialLookbackDays: number; pageSize: number; requestDelayMs: number; fetchComments: boolean; maxCommentsPerItem: number; maxBodyChars: number;
  workItemTypes: string[]; excludeWorkItemTypes: string[]; recordTypes: Record<string, SourceItem["recordType"]>; refPrefixes: Record<string, string>;
  textFields: { field: string; label: string }[]; resolutionFields?: string[]; analysisFields?: string[]; core: Record<string, string>; skipFields: string[]; skipFieldPrefixes: string[]; hdaRefPattern: string;
  /** approvedPaths: page paths (and everything below) whose pages count as approved knowledge in answers. */
  wiki: { enabled: boolean; approvedPaths: string[]; skipPaths: string[]; maxPages: number; batchSize: number; refreshHours: number; maxRefreshPerSync: number };
}
interface Settings { orgUrl?: string; project?: string; authMode?: AdoOptions["authMode"]; tenantId?: string; clientId?: string }

export function loadAdoMapping(file = process.env.ADO_MAPPING_FILE || "config/ado-mapping.json"): AdoMapping {
  return JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as AdoMapping;
}

/**
 * Work item types skipped for this connector: the list chosen on the Sources page, or the mapping's default
 * (test management items). Exported for the API and tests.
 */
export function excludedTypes(config: Record<string, unknown>, m: Pick<AdoMapping, "excludeWorkItemTypes">): string[] {
  return Array.isArray(config.excludeWorkItemTypes) ? (config.excludeWorkItemTypes as unknown[]).filter((x): x is string => typeof x === "string") : m.excludeWorkItemTypes;
}
/** The client for a connector, for API routes (folder-style pickers). */
export const adoClientFor = (ctx: Pick<SyncContext, "connectorId" | "config" | "secret">) => adoClient(ctx, loadAdoMapping());

/** Connector settings first, then .env. */
export function adoSettings(config: Record<string, unknown>) {
  const c = config as Settings;
  return {
    orgUrl: c.orgUrl || process.env.ADO_ORG_URL || "", project: c.project || process.env.ADO_PROJECT || "",
    authMode: (c.authMode || process.env.ADO_AUTH_MODE || "pat") as AdoOptions["authMode"],
    tenantId: c.tenantId || process.env.ADO_TENANT_ID || process.env.ENTRA_TENANT_ID, clientId: c.clientId || process.env.ADO_CLIENT_ID,
  };
}

const clients = new Map<string, AdoClient>();
function adoClient(ctx: Pick<SyncContext, "connectorId" | "config" | "secret">, m: AdoMapping, fresh = false): AdoClient {
  if (fresh) clients.delete(ctx.connectorId);
  let c = clients.get(ctx.connectorId);
  if (!c) {
    const s = adoSettings(ctx.config);
    if (!s.orgUrl || !s.project) throw new ConnectorError("NOT_CONFIGURED", "Set ADO_ORG_URL (e.g. https://dev.azure.com/ITRxSolutions) and ADO_PROJECT in .env, then test again.");
    if (s.authMode === "pat" && !ctx.secret("ADO_PAT")) throw new ConnectorError("NOT_CONFIGURED", "Set ADO_PAT in .env: a personal access token with the Work Items (Read) and Wiki (Read) scopes.");
    if (s.authMode === "entra" && (!s.tenantId || !s.clientId || !ctx.secret("ADO_CLIENT_SECRET"))) {
      throw new ConnectorError("NOT_CONFIGURED", "Set ADO_TENANT_ID, ADO_CLIENT_ID and ADO_CLIENT_SECRET for the service principal, and add it to the Azure DevOps organization with read access to work items.");
    }
    c = new AdoClient({ ...s, pat: ctx.secret("ADO_PAT"), clientSecret: ctx.secret("ADO_CLIENT_SECRET"), requestDelayMs: m.requestDelayMs });
    clients.set(ctx.connectorId, c);
  }
  return c;
}

const SEARCH_TYPES = new Set(["string", "plainText", "html", "treePath", "picklistString"]);
const isPerson = (v: unknown, f?: AdoField) => f?.isIdentity === true || f?.type === "identity" || (typeof v === "object" && v !== null && "displayName" in v);

/** Display text for one field value, or null when there's nothing worth showing. */
function display(v: unknown, f?: AdoField): string | null {
  if (v === null || v === undefined || v === "" || v === false) return null;
  if (isPerson(v, f)) return typeof v === "object" ? String((v as { displayName?: string }).displayName ?? "") || null : String(v).replace(/\s*<[^>]+>$/, "");
  if (v === true) return "Yes";
  if (f?.type === "dateTime" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v))) return toDate(v)?.toISOString() ?? String(v);
  if (typeof v === "object") return null;
  const text = f?.type === "html" || /<\/?[a-z][^>]*>/i.test(String(v)) ? stripHtml(v) : String(v).trim();
  return text || null;
}

const idFromUrl = (url: string) => /\/workItems\/(\d+)$/i.exec(url)?.[1] ?? null;
const LINK_KINDS: Record<string, "parent" | "linked" | "duplicate"> = {
  "System.LinkTypes.Hierarchy-Reverse": "parent", "System.LinkTypes.Related": "linked",
  "System.LinkTypes.Duplicate-Forward": "duplicate", "System.LinkTypes.Duplicate-Reverse": "duplicate", "System.LinkTypes.Dependency-Forward": "linked", "System.LinkTypes.Dependency-Reverse": "linked",
};

/**
 * The reference people use for a work item: its type's code and number (User Story 207077 → US_207077), as the
 * teams write it in titles. The code comes from the type, not the title, because title prefixes are often copied
 * from another item. Types without a configured code get their initials.
 */
export function adoRef(type: string, id: number | string, m: Pick<AdoMapping, "refPrefixes">): string {
  const code = m.refPrefixes?.[type] ?? type.split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase();
  return `${code || "WI"}_${id}`;
}

/** Maps one work item (and its comments) to a Synora item. Exported for tests. */
export function toWorkItem(wi: AdoWorkItem, m: AdoMapping, fieldMeta: Map<string, AdoField>, projectUrl: string, comments: { text: string; createdDate: string }[] = []): SourceItem {
  const f = wi.fields;
  const core = (k: string) => display(f[m.core[k]!], fieldMeta.get(m.core[k]!));
  const type = core("type") ?? "Work item";
  const textKeys = new Set(m.textFields.map((t) => t.field));

  const fields = Object.keys(f)
    .filter((k) => !m.skipFields.includes(k) && !m.skipFieldPrefixes.some((p) => k.startsWith(p)) && !textKeys.has(k))
    .map((k) => {
      const meta = fieldMeta.get(k);
      const value = display(f[k], meta);
      if (!value) return null;
      const person = isPerson(f[k], meta);
      const tier = !person && (meta ? SEARCH_TYPES.has(meta.type) : typeof f[k] === "string") && !/date/i.test(meta?.type ?? "") ? "search" : "detail";
      return { key: k, label: meta?.name ?? k.split(".").pop()!, value, tier, ...(person ? { person: true } : {}) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.label.localeCompare(b.label));

  const content = m.textFields.map((t) => ({ label: t.label, text: display(f[t.field], { referenceName: t.field, name: t.label, type: "html" }) })).filter((t) => t.text);
  // People's names stay out of the searchable text, so they are never embedded or sent to the AI.
  const details = fields.filter((x) => x.tier === "search" && !x.person).map((x) => `${x.label}: ${x.value}`);
  const discussion = comments.map((c) => ({ when: c.createdDate.slice(0, 10), text: stripHtml(c.text) })).filter((c) => c.text);
  let body = [
    ...content.map((t, i) => (i === 0 && t.label === "Description" ? t.text! : `${t.label}:\n${t.text}`)),
    details.length ? `Details:\n${details.join("\n")}` : "",
    discussion.length ? `Discussion:\n${discussion.map((c) => `[${c.when}] ${c.text}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  if (body.length > m.maxBodyChars) body = `${body.slice(0, m.maxBodyChars)}…`;

  const text = `${content.map((t) => t.text).join("\n")}\n${discussion.map((c) => c.text).join("\n")}`;
  const hdaRefs = [...new Set(text.match(new RegExp(m.hdaRefPattern, "g")) ?? [])];
  const mentioned = [...new Set([...text.matchAll(/(?:^|[\s(])#(\d{3,7})\b/g)].map((x) => x[1]!))].filter((n) => n !== String(wi.id));
  const links = [
    ...(wi.relations ?? []).flatMap((r) => { const id = idFromUrl(r.url); const kind = LINK_KINDS[r.rel]; return id && kind ? [{ ref: `WI-${id}`, kind }] : []; }),
    ...hdaRefs.map((ref) => ({ ref, kind: "mentions" as const })),
    ...mentioned.map((n) => ({ ref: `WI-${n}`, kind: "mentions" as const })),
  ];
  const severity = core("severity");
  const priority = core("priority");

  return {
    externalId: String(wi.id), ref: adoRef(type, wi.id, m), sourceSystem: "Azure DevOps", recordType: m.recordTypes[type] ?? "work_item",
    title: core("title") ?? `${type} ${wi.id}`, body, evidenceKind: "dev_work", approval: "not_reviewed",
    category: type, module: core("area"), environment: core("iteration"), status: core("state"),
    priority: severity ?? (priority ? `Priority ${priority}` : null),
    rootCause: core("rootCause"), resolution: resolutionOf(f, m) ?? core("resolvedReason"),
    createdAt: toDate(f[m.core.createdAt!]), updatedAt: toDate(f[m.core.changedAt!]),
    sourceUrl: `${projectUrl}/_workitems/edit/${wi.id}`, sensitivity: "internal", acl: [],
    links: [...new Map(links.map((l) => [`${l.kind}:${l.ref}`, l])).values()],
    raw: { type, rev: wi.rev, fields, analysis: analysisOf(f, m) },
  };
}

/** Readable text from wiki Markdown: no table of contents, images, diagrams or HTML; links keep their text. */
export function markdownText(md: string): string {
  return md
    .replace(/\[\[_TOC_\]\]|\[\[_TOSP_\]\]/gi, "")
    .replace(/^:::\s*mermaid[\s\S]*?^:::/gim, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const wikiPageId = (w: AdoWiki, path: string) => `wiki:${w.id}:${path}`;
const isWikiPage = (m: AdoMapping, path: string) => !m.wiki.skipPaths.some((p) => path.startsWith(p));

/** Maps one wiki page to a Synora document. Exported for tests. */
export function toWikiPage(w: AdoWiki, page: AdoWikiPage, markdown: string, m: AdoMapping, version: string | null = null): SourceItem {
  const path = page.path || "/";
  const title = path.split("/").filter(Boolean).pop() ?? w.name;
  const text = markdownText(markdown);
  const approved = m.wiki.approvedPaths.some((p) => p === "/" || path === p || path.startsWith(`${p.replace(/\/+$/, "")}/`));
  const hdaRefs = [...new Set(text.match(new RegExp(m.hdaRefPattern, "g")) ?? [])];
  const workItems = [...new Set([...text.matchAll(/(?:^|[\s(])#(\d{3,7})\b/g)].map((x) => x[1]!))];
  const body = `Wiki page ${w.name}${path}\n\n${text}`;
  return {
    externalId: wikiPageId(w, path), ref: `${w.name}${path}`.slice(0, 200), sourceSystem: "Azure DevOps Wiki", recordType: "document",
    title, body: body.length > m.maxBodyChars ? `${body.slice(0, m.maxBodyChars)}…` : body,
    evidenceKind: approved ? "approved" : "reference", approval: approved ? "approved" : "not_reviewed",
    category: "Wiki page", module: path.split("/").filter(Boolean).slice(0, -1).join("/") || null, sensitivity: "internal", acl: [],
    sourceUrl: page.remoteUrl ?? `${w.remoteUrl}?pagePath=${encodeURIComponent(path)}`,
    links: [...hdaRefs.map((ref) => ({ ref, kind: "mentions" as const })), ...workItems.map((n) => ({ ref: `WI-${n}`, kind: "mentions" as const }))],
    raw: { wiki: w.name, wikiId: w.id, path, version, fields: [{ key: "wiki", label: "Wiki", value: w.name, tier: "detail" }, { key: "page", label: "Page", value: path, tier: "detail" }] },
  };
}

/** Per wiki, per page path: the version last stored (ETag) and when it was last read. Kept in the cursor. */
type WikiState = Record<string, Record<string, { v: string | null; at: number }>>;
export function parseWikiState(cursor: string | null): WikiState {
  try {
    const w = (JSON.parse(cursor ?? "") as { wiki?: Record<string, Record<string, unknown>> }).wiki;
    if (!w || typeof w !== "object") return {};
    return Object.fromEntries(Object.entries(w).map(([id, pages]) => [id, Object.fromEntries(Object.entries(pages ?? {}).map(([p, x]) =>
      [p, x && typeof x === "object" ? (x as { v: string | null; at: number }) : { v: null, at: 0 }]))]));
  } catch { return {}; }
}

/** Which pages to read this sync: new ones, then the longest-unchecked known ones that are due. Exported for tests. */
export function wikiReadPlan(pages: AdoWikiPage[], seen: Record<string, { v: string | null; at: number }>, m: AdoMapping, now = Date.now()) {
  const fresh = pages.filter((p) => !seen[p.path]);
  const due = pages.filter((p) => seen[p.path] && now - seen[p.path]!.at > m.wiki.refreshHours * 3600_000)
    .sort((a, b) => seen[a.path]!.at - seen[b.path]!.at).slice(0, m.wiki.maxRefreshPerSync);
  return [...fresh, ...due];
}

/** The team's investigation notes (Analysis): what was checked and found, which helps with the next similar issue. */
function analysisOf(f: Record<string, unknown>, m: AdoMapping): string | null {
  const parts = (m.analysisFields ?? []).map((k) => display(f[k], { referenceName: k, name: k, type: "html" })).filter((v): v is string => !!v);
  const text = parts.join("\n\n");
  return text ? (text.length > 4000 ? `${text.slice(0, 4000)}…` : text) : null;
}

/** What fixed the item: the first resolution field filled in (Solution, Resolution…), as plain text. */
function resolutionOf(f: Record<string, unknown>, m: AdoMapping): string | null {
  for (const k of m.resolutionFields ?? [m.core.resolution!]) {
    const v = display(f[k], { referenceName: k, name: k, type: "html" });
    if (v) return v.length > 4000 ? `${v.slice(0, 4000)}…` : v;
  }
  return null;
}

/** Keyset position: everything changed after `at`, or at `at` with a higher id. */
interface Position { at: string; id: number }
export function parseCursor(cursor: string | null, lookbackDays: number): Position {
  try { const p = JSON.parse(cursor ?? "") as Position; if (p.at && Number.isFinite(p.id)) return p; } catch { /* older or empty cursor */ }
  const at = cursor && !Number.isNaN(Date.parse(cursor)) ? new Date(cursor) : new Date(Date.now() - lookbackDays * 864e5);
  return { at: at.toISOString(), id: 0 };
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** The WIQL for one page. Exported for tests. */
export function pageQuery(m: AdoMapping, pos: Position): string {
  const typeFilter = [
    m.workItemTypes.length ? ` AND [System.WorkItemType] IN (${m.workItemTypes.map(quote).join(", ")})` : "",
    m.excludeWorkItemTypes.length ? ` AND [System.WorkItemType] NOT IN (${m.excludeWorkItemTypes.map(quote).join(", ")})` : "",
  ].join("");
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project${typeFilter}`
    + ` AND ([System.ChangedDate] > ${quote(pos.at)} OR ([System.ChangedDate] = ${quote(pos.at)} AND [System.Id] > ${Math.trunc(pos.id)}))`
    + " ORDER BY [System.ChangedDate] ASC, [System.Id] ASC";
}

const toConnectorError = (e: unknown) => {
  if (e instanceof AdoError) return new ConnectorError(e.info.auth ? "AUTH" : e.info.status && e.info.status < 500 ? "REJECTED" : "UNREACHABLE", e.message, !e.info.auth && !(e.info.status && e.info.status < 500));
  return e;
};

export const adoConnector: Connector = {
  type: "ado",
  label: "Azure DevOps",

  progress(cursor) {
    if (!cursor) return null;
    const m = loadAdoMapping();
    const pages = Object.values(parseWikiState(cursor)).reduce((n, w) => n + Object.keys(w).length, 0);
    const p = datePosition("Work items changed", new Date(parseCursor(cursor, m.initialLookbackDays).at), m.initialLookbackDays);
    return p && { ...p, detail: [p.detail, pages ? `${pages.toLocaleString("en-GB")} wiki pages read` : ""].filter(Boolean).join(" · ") };
  },

  async testConnection(ctx): Promise<TestResult> {
    const m = loadAdoMapping();
    try {
      const client = adoClient(ctx, m, true); // a test always uses the current settings
      const project = await client.projectInfo();
      const ids = await client.wiql(pageQuery(m, parseCursor(null, 36500)).replace("ASC, [System.Id] ASC", "DESC"), 5);
      const items = await client.workItems(ids);
      const fieldCount = new Set(items.flatMap((w) => Object.keys(w.fields))).size;
      const withComments = items.filter((w) => Number(w.fields[m.core.commentCount!] ?? 0) > 0).length;
      let wikiNote = "";
      if (m.wiki.enabled) {
        try {
          const wikis = await client.wikis();
          const pages = wikis.length ? (await client.wikiPages(wikis[0]!)).filter((p) => isWikiPage(m, p.path)).length : 0;
          wikiNote = wikis.length ? ` Wikis: ${wikis.map((w) => w.name).join(", ")} (${pages} pages in ${wikis[0]!.name}).` : " The project has no wiki.";
        } catch (e) {
          wikiNote = ` The wikis could not be read (${e instanceof AdoError ? e.message : "unknown error"}).`;
        }
      }
      if (!items.length) return { ok: true, level: "warn", message: `Connected to ${project.name}, but no work items were returned. Check the work item type filters in config/ado-mapping.json.` };
      return { ok: true, level: "ok", message: `Connected to ${project.name}. ${items.length} recent work items read with ${fieldCount} fields; ${withComments} have comments${m.fetchComments ? ", which are indexed too" : ""}.${wikiNote}`, sample: items.length };
    } catch (e) {
      const err = toConnectorError(e);
      return { ok: false, level: "error", message: err instanceof ConnectorError ? err.message : "The connection test failed." };
    }
  },

  async *fetchChanges(ctx, cursor): AsyncGenerator<ChangeBatch> {
    const base = loadAdoMapping();
    const m = { ...base, excludeWorkItemTypes: excludedTypes(ctx.config, base) };
    const client = adoClient(ctx, m);
    let pos = parseCursor(cursor, m.initialLookbackDays);
    let wikiState = parseWikiState(cursor);
    const state = () => JSON.stringify({ ...pos, wiki: wikiState });
    try {
      const fieldMeta = new Map((await client.fields()).map((f) => [f.referenceName, f]));
      const deleted = (await client.deletedIds()).map(String);
      // Wikis first: they are small (minutes, not hours) and give answers the most context, so a long work item
      // backlog never holds them back. Work items then continue from their own saved position.
      if (m.wiki.enabled) {
        try {
          const next: WikiState = {};
          for (const w of await client.wikis()) {
            const seen = wikiState[w.id] ?? {};
            const pages = (await client.wikiPages(w)).filter((p) => isWikiPage(m, p.path)).slice(0, m.wiki.maxPages);
            const present = new Set(pages.map((p) => p.path));
            deleted.push(...Object.keys(seen).filter((p) => !present.has(p)).map((p) => wikiPageId(w, p)));
            const done = Object.fromEntries(Object.entries(seen).filter(([p]) => present.has(p)));
            const plan = wikiReadPlan(pages, seen, m);
            for (let i = 0; i < plan.length; i += m.wiki.batchSize) {
              const items: SourceItem[] = [];
              for (const page of plan.slice(i, i + m.wiki.batchSize)) {
                try {
                  const { content, version } = await client.wikiPage(w, page.path);
                  // Parent pages are often empty; an emptied page leaves the index.
                  if (!markdownText(content)) deleted.push(wikiPageId(w, page.path));
                  else if (!seen[page.path] || seen[page.path]!.v !== version || !version) items.push(toWikiPage(w, page, content, m, version));
                  done[page.path] = { v: version, at: Date.now() };
                } catch (e) {
                  if (e instanceof AdoError && e.info.auth) throw e;
                  ctx.log(`Wiki page ${w.name}${page.path} could not be read; it is tried again next sync.`);
                }
              }
              // Saved as we go: pages already stored aren't read again if the sync is interrupted.
              wikiState = { ...wikiState, [w.id]: done };
              yield { items, cursor: state(), done: false };
            }
            next[w.id] = done;
          }
          wikiState = next;
        } catch (e) {
          // Wikis are an addition: without the Wiki (Read) scope the work items still sync.
          if (!(e instanceof AdoError)) throw e;
          ctx.log(`The project wikis could not be read (${e.message}).`);
        }
      }

      for (;;) {
        const ids = await client.wiql(pageQuery(m, pos), m.pageSize);
        if (!ids.length) break;
        const byId = new Map((await client.workItems(ids)).map((w) => [w.id, w]));
        const items: SourceItem[] = [];
        for (const id of ids) {
          const wi = byId.get(id);
          if (!wi) continue; // deleted or moved between the two calls
          let comments: { text: string; createdDate: string }[] = [];
          if (m.fetchComments && Number(wi.fields[m.core.commentCount!] ?? 0) > 0) {
            try { comments = (await client.comments(id, m.maxCommentsPerItem)).filter((c) => !c.isDeleted); }
            catch { ctx.log(`Comments of work item ${id} could not be read; indexed without them.`); }
          }
          items.push(toWorkItem(wi, m, fieldMeta, client.projectUrl, comments));
          const at = toDate(wi.fields[m.core.changedAt!]);
          if (at) pos = { at: at.toISOString(), id };
        }
        yield { items, cursor: state(), done: false };
        if (ids.length < m.pageSize) break;
      }

      yield { items: [], deleted, cursor: state(), done: true };
    } catch (e) {
      throw toConnectorError(e);
    }
  },
};

/** The connector row for a new Azure DevOps source: Development space, hourly, the PAT read from .env. */
export function adoConnectorRow(spaceId: string) {
  const s = adoSettings({});
  return {
    type: "ado", name: `Azure DevOps (${s.project || "project"})`, spaceId, ownerGroup: "Platform Engineering", status: "not_configured", schedule: "hourly",
    secretRef: s.authMode === "entra" ? "env:ADO_CLIENT_SECRET" : "env:ADO_PAT", config: { orgUrl: s.orgUrl, project: s.project, authMode: s.authMode },
    statusNote: "Set ADO_PAT in .env (a personal access token with the Work Items (Read) and Wiki (Read) scopes), then test the connection.",
  };
}
