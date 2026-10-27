// Azure DevOps REST client (read-only): WIQL, work items batch, comments, fields, recycle bin, wiki pages.
//   * Sign-in: a personal access token (Basic auth) or an Entra service principal (client credentials, scope
//     499b84ac-1321-427f-aa17-267ca6975798/.default, the Azure DevOps resource).
//   * A bad or expired PAT often answers 203 with an HTML sign-in page instead of 401, so non-JSON means "sign-in".
//   * Requests go one at a time with a minimum gap, and Azure DevOps' throttling hints (Retry-After,
//     X-RateLimit-Delay) are obeyed, so a sync never pushes the organization into rate limiting.

export class AdoError extends Error {
  constructor(message: string, readonly info: { status?: number; path?: string; auth?: boolean } = {}) {
    super(message);
    this.name = "AdoError";
  }
}

export interface AdoOptions {
  orgUrl: string;
  project: string;
  authMode: "pat" | "entra";
  pat?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  requestDelayMs?: number;
  timeoutMs?: number;
}

export interface AdoWorkItem { id: number; rev?: number; fields: Record<string, unknown>; relations?: { rel: string; url: string; attributes?: Record<string, unknown> }[]; url?: string }
export interface AdoComment { id: number; text: string; createdDate: string; isDeleted?: boolean }
export interface AdoField { referenceName: string; name: string; type: string; isIdentity?: boolean }
export interface AdoWiki { id: string; name: string; type: "projectWiki" | "codeWiki"; repositoryId: string; mappedPath?: string; remoteUrl: string; versions?: { version: string }[] }
export interface AdoWikiPage { path: string; isParentPage?: boolean; remoteUrl?: string }

const API = "7.1";
const MAX_RETRIES = 3;

export class AdoClient {
  private token: string | null = null;
  private expiresAt = 0;
  private lastCallAt = 0;
  /** ETag of the last response (calls run one at a time), used as a wiki page's version. */
  private lastEtag: string | null = null;

  constructor(private readonly opts: AdoOptions) {}

  get project() { return this.opts.project; }
  /** Base URL for links people open: https://dev.azure.com/org/Project%20Name */
  get projectUrl() { return `${this.opts.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(this.opts.project)}`; }

  private async authorization(): Promise<string> {
    const o = this.opts;
    if (o.authMode === "pat") return `Basic ${Buffer.from(`:${o.pat ?? ""}`).toString("base64")}`;
    if (this.token && Date.now() < this.expiresAt - 60_000) return `Bearer ${this.token}`;
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(o.tenantId ?? "")}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: o.clientId ?? "", client_secret: o.clientSecret ?? "", scope: "499b84ac-1321-427f-aa17-267ca6975798/.default" }),
    }).catch(() => { throw new AdoError("Entra ID could not be reached to get an Azure DevOps token.", { auth: true }); });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !json.access_token) throw new AdoError(`Entra ID refused the Azure DevOps token: ${json.error_description?.split("\r\n")[0] ?? res.status}`, { status: res.status, auth: true });
    this.token = json.access_token;
    this.expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return `Bearer ${this.token}`;
  }

  /** `path` is relative to the organization; project-scoped calls start with the encoded project name. */
  private async call<T>(method: "GET" | "POST", path: string, { query, body }: { query?: Record<string, string | number | undefined>; body?: unknown } = {}, attempt = 0): Promise<T> {
    const url = new URL(`${this.opts.orgUrl.replace(/\/+$/, "")}/${path}`);
    url.searchParams.set("api-version", url.searchParams.get("api-version") ?? API);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: "application/json", Authorization: await this.authorization() };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const wait = this.lastCallAt + (this.opts.requestDelayMs ?? 0) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000), redirect: "manual" });
    } catch (e) {
      throw new AdoError(`Azure DevOps could not be reached (${(e as { name?: string }).name === "TimeoutError" ? "timeout" : "network error"}).`, { path });
    }

    // Throttled: wait as long as Azure DevOps asks (capped), then try again.
    const delay = Number(res.headers.get("Retry-After") ?? res.headers.get("X-RateLimit-Delay") ?? 0);
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.min(Math.max(delay, 5), 60) * 1000));
      return this.call<T>(method, path, { query, body }, attempt + 1);
    }
    if (delay > 0) this.lastCallAt = Date.now() + Math.min(delay, 60) * 1000; // slow down before the next call

    this.lastEtag = res.headers.get("ETag");
    const text = await res.text();
    const authFailed = res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400);
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      if (authFailed || /<html/i.test(text)) throw new AdoError(`Azure DevOps refused ${url.pathname.split("/_apis/")[1]?.split("/")[0] ?? "the request"}: the token is invalid or expired, or lacks the scope for it (Synora needs Work Items (Read) and Wiki (Read)).`, { status: res.status, path, auth: true });
      throw new AdoError(`Azure DevOps returned a non-JSON answer (${res.status}) for ${url.pathname}.`, { status: res.status, path });
    }
    if (!res.ok) {
      const message = (json as { message?: string }).message ?? String(res.status);
      throw new AdoError(`Azure DevOps error on ${url.pathname}: ${message}`, { status: res.status, path, auth: res.status === 401 || res.status === 403 });
    }
    return json as T;
  }

  private get p() { return encodeURIComponent(this.opts.project); }

  projectInfo() { return this.call<{ id: string; name: string; description?: string }>("GET", `_apis/projects/${this.p}`); }
  /** Ids matching a WIQL query, in the query's order. timePrecision lets date filters use the time of day. */
  async wiql(query: string, top: number): Promise<number[]> {
    const r = await this.call<{ workItems: { id: number }[] }>("POST", `${this.p}/_apis/wit/wiql`, { query: { $top: top, timePrecision: "true" }, body: { query } });
    return r.workItems.map((w) => w.id);
  }
  /** Up to 200 work items with every field and their links. */
  async workItems(ids: number[]): Promise<AdoWorkItem[]> {
    if (!ids.length) return [];
    const r = await this.call<{ value: AdoWorkItem[] }>("POST", `${this.p}/_apis/wit/workitemsbatch`, { body: { ids, $expand: "Relations", errorPolicy: "Omit" } });
    return r.value.filter(Boolean);
  }
  async comments(id: number, max = 200): Promise<AdoComment[]> {
    const out: AdoComment[] = [];
    let token: string | undefined;
    do {
      const r = await this.call<{ comments: AdoComment[]; continuationToken?: string }>("GET", `${this.p}/_apis/wit/workItems/${id}/comments`, { query: { "api-version": "7.1-preview.4", $top: 200, continuationToken: token } });
      out.push(...r.comments);
      token = r.continuationToken;
    } while (token && out.length < max);
    return out.slice(0, max);
  }
  /** The project's work item types (enabled ones only). */
  async workItemTypes(): Promise<string[]> {
    const r = await this.call<{ value: { name: string; isDisabled?: boolean }[] }>("GET", `${this.p}/_apis/wit/workitemtypes`);
    return r.value.filter((t) => !t.isDisabled).map((t) => t.name);
  }
  async fields(): Promise<AdoField[]> { return (await this.call<{ value: AdoField[] }>("GET", `${this.p}/_apis/wit/fields`)).value; }
  /** The project's wikis: the project wiki and any code wikis published from a repository. */
  async wikis(): Promise<AdoWiki[]> { return (await this.call<{ value: AdoWiki[] }>("GET", `${this.p}/_apis/wiki/wikis`)).value; }
  /** Every page of a wiki in one call: its path and web link. Needs only the Wiki (Read) scope. */
  async wikiPages(w: AdoWiki): Promise<AdoWikiPage[]> {
    type Node = AdoWikiPage & { subPages?: Node[] };
    const root = await this.call<Node>("GET", `${this.p}/_apis/wiki/wikis/${w.id}/pages`, { query: { path: "/", recursionLevel: "full" } });
    const out: AdoWikiPage[] = [];
    const walk = (n: Node) => { out.push({ path: n.path, isParentPage: n.isParentPage, remoteUrl: n.remoteUrl }); (n.subPages ?? []).forEach(walk); };
    walk(root);
    return out;
  }
  /** One page's Markdown and version (its ETag). Azure DevOps doesn't answer conditional requests here, so it's a full read. */
  async wikiPage(w: AdoWiki, path: string): Promise<{ content: string; version: string | null }> {
    const r = await this.call<{ content?: string }>("GET", `${this.p}/_apis/wiki/wikis/${w.id}/pages`, { query: { path, includeContent: "true" } });
    return { content: r.content ?? "", version: this.lastEtag };
  }
  /** Work items deleted to the recycle bin; their records leave Synora. */
  async deletedIds(): Promise<number[]> {
    const r = await this.call<{ value: { id: number }[] }>("GET", `${this.p}/_apis/wit/recyclebin`, { query: { "api-version": "7.1-preview.2" } });
    return r.value.map((w) => w.id);
  }
}
