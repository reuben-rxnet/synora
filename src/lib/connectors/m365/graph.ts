// Microsoft Graph client for SharePoint and OneDrive files (read-only).
//   * One request at a time with a minimum gap; 429/503 answers wait for Retry-After (capped) and try again.
//   * Downloads follow Graph's redirect to a pre-signed URL; fetch drops the Authorization header on that
//     cross-origin hop, so the token never goes to the download host.
import { ConnectorError } from "../types";

export interface DriveItem {
  id: string; name: string; size?: number; webUrl?: string; cTag?: string; eTag?: string;
  createdDateTime?: string; lastModifiedDateTime?: string;
  file?: { mimeType?: string }; folder?: { childCount?: number }; package?: { type?: string };
  parentReference?: { driveId?: string; id?: string; path?: string };
  createdBy?: { user?: { displayName?: string } }; lastModifiedBy?: { user?: { displayName?: string } };
}
export interface Drive { id: string; name: string; driveType: string; webUrl?: string; owner?: { user?: { displayName?: string } } }
export interface Site { id: string; displayName: string; webUrl: string; name?: string }

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "GraphError"; }
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const ITEM_FIELDS = "id,name,size,webUrl,cTag,eTag,createdDateTime,lastModifiedDateTime,file,folder,package,parentReference,createdBy,lastModifiedBy";

export class GraphClient {
  private lastCallAt = 0;
  constructor(private readonly token: () => Promise<string>, private readonly delayMs = 150) {}

  private async request(url: string, attempt = 0): Promise<Response> {
    const wait = this.lastCallAt + this.delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
    let res: Response;
    try {
      res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, { headers: { Authorization: `Bearer ${await this.token()}`, Accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      if (e instanceof ConnectorError) throw e;
      throw new ConnectorError("UNREACHABLE", "Microsoft Graph could not be reached.", true);
    }
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
      const after = Number(res.headers.get("Retry-After") ?? 0);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(after, 2 ** attempt * 2), 120) * 1000));
      return this.request(url, attempt + 1);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new GraphError(body.error?.message ?? `Microsoft Graph answered ${res.status}.`, res.status, body.error?.code);
    }
    return res;
  }

  async get<T>(path: string): Promise<T> { return (await (await this.request(path)).json()) as T; }
  /** Every page of a collection (follows @odata.nextLink). */
  async all<T>(path: string, max = 100_000): Promise<T[]> {
    const out: T[] = [];
    for (let next: string | undefined = path; next && out.length < max;) {
      const page: { value: T[]; "@odata.nextLink"?: string } = await this.get(next);
      out.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return out;
  }
  async bytes(path: string): Promise<Buffer> { return Buffer.from(await (await this.request(path)).arrayBuffer()); }

  me() { return this.get<{ displayName: string; userPrincipalName: string; mail?: string }>("/me?$select=displayName,userPrincipalName,mail"); }
  /** A site from its address, e.g. https://contoso.sharepoint.com/sites/Support. */
  site(url: string) {
    const u = new URL(url);
    return this.get<Site>(`/sites/${u.hostname}:${u.pathname.replace(/\/+$/, "") || "/"}?$select=id,displayName,webUrl,name`);
  }
  siteDrives(siteId: string) { return this.all<Drive>(`/sites/${siteId}/drives?$select=id,name,driveType,webUrl`); }
  myDrive() { return this.get<Drive>("/me/drive?$select=id,name,driveType,webUrl,owner"); }
  item(driveId: string, itemId: string) { return this.get<DriveItem>(`/drives/${driveId}/items/${itemId}?$select=${ITEM_FIELDS}`); }
  children(driveId: string, itemId: string) { return this.all<DriveItem>(`/drives/${driveId}/items/${itemId}/children?$select=${ITEM_FIELDS}&$top=200`); }
  /** The file itself, or (format=pdf) the PDF Microsoft 365 converts Office files to. */
  content(driveId: string, itemId: string, format?: "pdf") { return this.bytes(`/drives/${driveId}/items/${itemId}/content${format ? `?format=${format}` : ""}`); }
}
