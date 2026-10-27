// SharePoint & OneDrive connector: the files in the folders an administrator chose become searchable documents.
//   * Delegated access: it reads as the person who signed in to Microsoft 365 on the Sources page, so it can only
//     ever see what that person can open.
//   * Each sync lists the chosen folders (and their sub-folders) and reads only files whose change tag (cTag)
//     differs from the last sync; files that disappeared leave Synora. The state is kept in the cursor.
//   * Formats: see ./extract.ts. Files Synora can't read, or above the size limits, are skipped.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConnectorError, type ChangeBatch, type Connector, type SourceItem, type SyncContext, type TestResult } from "../types";
import { accessToken, loadCredential } from "./auth";
import { closeOcr, extractText, fileKind, fileKindLabel, type Extracted } from "./extract";
import { GraphClient, GraphError, type DriveItem } from "./graph";

export interface M365Mapping {
  requestDelayMs: number; batchSize: number; maxFileMB: number; maxImageMB: number; maxFilesPerFolder: number; maxDepth: number; maxBodyChars: number; hdaRefPattern: string;
}
/** A folder chosen on the Sources page. `approved`: its documents count as approved knowledge in answers. */
export interface ChosenFolder { driveId: string; itemId: string; name: string; path: string; source: "sharepoint" | "onedrive"; approved?: boolean }

export function loadM365Mapping(file = process.env.M365_MAPPING_FILE || "config/m365-mapping.json"): M365Mapping {
  return JSON.parse(readFileSync(join(process.cwd(), file), "utf8")) as M365Mapping;
}
export const chosenFolders = (config: Record<string, unknown>): ChosenFolder[] =>
  Array.isArray(config.folders) ? (config.folders as ChosenFolder[]).filter((f) => f && typeof f.driveId === "string" && typeof f.itemId === "string") : [];
export const folderKey = (f: Pick<ChosenFolder, "driveId" | "itemId">) => `${f.driveId}:${f.itemId}`;
export const graphFor = (connectorId: string, m = loadM365Mapping()) => new GraphClient(() => accessToken(connectorId), m.requestDelayMs);

const toConnectorError = (e: unknown) => {
  if (e instanceof GraphError) {
    if (e.status === 401) return new ConnectorError("AUTH", "Microsoft 365 refused the sign-in. Sign in to Microsoft 365 again on the Sources page.");
    if (e.status === 403) return new ConnectorError("AUTH", `Microsoft 365 denied access (${e.message}). The signed-in account needs read access, and the app needs the Files.Read.All and Sites.Read.All permissions.`);
    return new ConnectorError(e.status >= 500 ? "UNREACHABLE" : "REJECTED", `Microsoft Graph: ${e.message}`, e.status >= 500);
  }
  return e;
};

/** Every readable file below a chosen folder, with its path. Exported for tests. */
export async function listFiles(g: Pick<GraphClient, "children">, folder: ChosenFolder, m: M365Mapping): Promise<{ item: DriveItem; path: string }[]> {
  const out: { item: DriveItem; path: string }[] = [];
  const queue = [{ id: folder.itemId, path: folder.path, depth: 0 }];
  while (queue.length && out.length < m.maxFilesPerFolder) {
    const dir = queue.shift()!;
    for (const item of await g.children(folder.driveId, dir.id)) {
      if (item.folder && !item.package && dir.depth < m.maxDepth) queue.push({ id: item.id, path: `${dir.path}/${item.name}`, depth: dir.depth + 1 });
      else if (item.file && fileKind(item.name)) out.push({ item, path: dir.path });
    }
  }
  return out.slice(0, m.maxFilesPerFolder);
}

const mb = (n?: number) => (n ?? 0) / 1_048_576;
/** Why a file is skipped, or null when it should be read. */
export function skipReason(item: DriveItem, m: M365Mapping): string | null {
  const kind = fileKind(item.name);
  if (!kind) return "not a format Synora reads";
  const limit = kind === "image" ? m.maxImageMB : m.maxFileMB;
  return mb(item.size) > limit ? `larger than ${limit} MB` : null;
}

/** Maps one file and its text to a Synora document. Exported for tests. */
export function toFileItem(folder: ChosenFolder, item: DriveItem, path: string, ex: Extracted, m: M365Mapping): SourceItem {
  const text = ex.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  let body = `${path}/${item.name}\n\n${text || "(No readable text in this file.)"}`;
  if (body.length > m.maxBodyChars) body = `${body.slice(0, m.maxBodyChars)}…`;
  const hdaRefs = [...new Set(text.match(new RegExp(m.hdaRefPattern, "g")) ?? [])];
  const workItems = [...new Set(text.match(/\bWI-\d{3,7}\b/g) ?? [])];
  const person = (label: string, v?: string) => (v ? [{ key: label.toLowerCase().replace(/\s+/g, ""), label, value: v, tier: "detail", person: true }] : []);
  return {
    externalId: `${folder.driveId}:${item.id}`, ref: item.name.slice(0, 200), sourceSystem: folder.source === "onedrive" ? "OneDrive" : "SharePoint",
    recordType: "document", title: item.name, body,
    evidenceKind: folder.approved ? "approved" : "reference", approval: folder.approved ? "approved" : "not_reviewed",
    category: fileKindLabel(item.name), module: path, createdAt: item.createdDateTime ? new Date(item.createdDateTime) : null,
    updatedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null, sourceUrl: item.webUrl ?? null, sensitivity: "internal", acl: [],
    links: [...hdaRefs, ...workItems].map((ref) => ({ ref, kind: "mentions" as const })),
    raw: {
      driveId: folder.driveId, itemId: item.id, folderKey: folderKey(folder), cTag: item.cTag,
      fields: [
        { key: "location", label: "Location", value: path, tier: "detail" },
        { key: "fileType", label: "File type", value: fileKindLabel(item.name), tier: "detail" },
        { key: "size", label: "Size", value: `${Math.max(1, Math.round((item.size ?? 0) / 1024))} KB`, tier: "detail" },
        { key: "textFrom", label: "Text read as", value: ex.method, tier: "detail" },
        ...person("Created by", item.createdBy?.user?.displayName), ...person("Modified by", item.lastModifiedBy?.user?.displayName),
      ],
    },
  };
}

/** Per chosen folder: item id → change tag of the version stored. Kept in the cursor. */
type FileState = Record<string, Record<string, string>>;
export function parseFileState(cursor: string | null): FileState {
  try { const f = (JSON.parse(cursor ?? "") as { files?: FileState }).files; return f && typeof f === "object" ? f : {}; } catch { return {}; }
}

async function readFile(g: GraphClient, folder: ChosenFolder, item: DriveItem): Promise<Extracted | null> {
  const office = fileKind(item.name) === "office";
  return extractText(item.name, await g.content(folder.driveId, item.id, office ? "pdf" : undefined));
}

export const m365Connector: Connector = {
  type: "m365",
  label: "SharePoint & OneDrive",

  progress(cursor) {
    const files = Object.values(parseFileState(cursor)).reduce((n, f) => n + Object.keys(f).length, 0);
    return files ? { position: `${files.toLocaleString("en-GB")} files read in the chosen folders`, fraction: null } : null;
  },

  async testConnection(ctx): Promise<TestResult> {
    try {
      const cred = await loadCredential(ctx.connectorId);
      if (!cred) return { ok: false, level: "warn", message: "Not signed in yet. Choose Sign in to Microsoft 365, then choose the folders to index." };
      const g = graphFor(ctx.connectorId);
      const me = await g.me();
      const folders = chosenFolders(ctx.config);
      const notes: string[] = [];
      for (const f of folders) {
        try { await g.item(f.driveId, f.itemId); } catch (e) { notes.push(`${f.path} can't be opened (${e instanceof GraphError ? e.message : "error"})`); }
      }
      if (!folders.length) return { ok: true, level: "warn", message: `Signed in as ${me.displayName}. Choose the folders Synora should read (Folders on the card).` };
      return { ok: true, level: notes.length ? "warn" : "ok", message: `Signed in as ${me.displayName}. ${folders.length - notes.length} of ${folders.length} chosen folders can be read.${notes.length ? ` ${notes.join("; ")}.` : ""}` };
    } catch (e) {
      const err = toConnectorError(e);
      return { ok: false, level: "error", message: err instanceof Error ? err.message : "The connection test failed." };
    }
  },

  async *fetchChanges(ctx: SyncContext, cursor): AsyncGenerator<ChangeBatch> {
    const m = loadM365Mapping();
    const folders = chosenFolders(ctx.config);
    if (!folders.length) throw new ConnectorError("SETUP", "Choose at least one SharePoint or OneDrive folder (Sources → SharePoint & OneDrive → Folders) before syncing.");
    const g = graphFor(ctx.connectorId, m);
    let state = parseFileState(cursor);
    const save = () => JSON.stringify({ files: state });
    const deleted: string[] = [];
    try {
      for (const folder of folders) {
        const key = folderKey(folder);
        const seen = state[key] ?? {};
        const files = await listFiles(g, folder, m);
        const present = new Set(files.map((f) => f.item.id));
        deleted.push(...Object.keys(seen).filter((id) => !present.has(id)).map((id) => `${folder.driveId}:${id}`));
        const done: Record<string, string> = Object.fromEntries(Object.entries(seen).filter(([id]) => present.has(id)));
        const changed = files.filter((f) => seen[f.item.id] !== (f.item.cTag ?? f.item.eTag ?? f.item.lastModifiedDateTime));
        for (let i = 0; i < changed.length; i += m.batchSize) {
          const items: SourceItem[] = [];
          for (const { item, path } of changed.slice(i, i + m.batchSize)) {
            const tag = item.cTag ?? item.eTag ?? item.lastModifiedDateTime ?? "";
            const why = skipReason(item, m);
            if (why) { done[item.id] = tag; ctx.log(`Skipped ${path}/${item.name}: ${why}.`); continue; }
            try {
              const ex = await readFile(g, folder, item);
              if (ex) items.push(toFileItem(folder, item, path, ex, m));
              done[item.id] = tag;
            } catch (e) {
              // A lost sign-in stops the sync; one file that can't be opened or converted is only noted.
              if (e instanceof ConnectorError || (e instanceof GraphError && e.status === 401)) throw e;
              ctx.log(`${path}/${item.name} could not be read (${e instanceof Error ? e.message.slice(0, 160) : "error"}); it is tried again next sync.`);
            }
          }
          // Saved as we go: files already stored aren't read again if the sync is interrupted.
          state = { ...state, [key]: done };
          yield { items, cursor: save(), done: false };
        }
        state = { ...state, [key]: done };
      }
      // Folders that are no longer chosen drop out of the state (their records were removed when they were unchosen).
      state = Object.fromEntries(Object.entries(state).filter(([k]) => folders.some((f) => folderKey(f) === k)));
      yield { items: [], deleted, cursor: save(), done: true };
    } catch (e) {
      throw toConnectorError(e);
    } finally {
      await closeOcr();
    }
  },
};

/** The connector row for a new SharePoint & OneDrive source. */
export function m365ConnectorRow(spaceId: string) {
  return {
    type: "m365", name: "SharePoint & OneDrive", spaceId, ownerGroup: "Central Rx Operations Support", status: "not_configured", schedule: "6h",
    secretRef: null, config: { siteUrl: process.env.M365_SITE_URL || "", folders: [] },
    statusNote: "Sign in to Microsoft 365 on this card, then choose the folders Synora should read.",
  };
}
