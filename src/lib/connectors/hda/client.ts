// HDA (HelpDesk Advanced) REST client. Ported from CSAT Pulse (D:\Projects\CSAT_HDA\src\hda\client.js):
//   POST /Authentication/LoginEx | /Authentication/Token | /Authentication/RefreshToken
//   GET  /WSC/Projection, /WSC/List, /WSC/Get, /WSC/GetMetabase
// Every response carries { success, data, total, result: { code: "0" = OK, desc } }.
// Facts learned there: LoginEx needs an Accept-Language header (Node's default "*" gives code 99); off the
// corporate network the host answers with IIS 404 pages; a rejected sign-in stops further attempts so an
// AD account can't be locked by retries.

export class HdaError extends Error {
  constructor(message: string, readonly info: { status?: number; path?: string; result?: unknown; authBlocked?: boolean } = {}) {
    super(message);
    this.name = "HdaError";
  }
}

export interface HdaOptions {
  baseUrl: string;
  authMode: "login" | "apikey" | "trusted";
  username?: string;
  password?: string;
  apiKey?: string;
  sourceApplication?: string;
  timeoutMs?: number;
  acceptLanguage?: string;
}

type Json = { success?: boolean; data?: unknown; total?: number; result?: { code?: string | number; desc?: string; subcode?: string }; requestToken?: string; refreshToken?: string; expiresIn?: number | string };

export class HdaClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private retrying = false;
  authBlocked: { at: Date; message: string } | null = null;

  constructor(private readonly opts: HdaOptions) {}

  clearAuthBlock() { this.authBlocked = null; this.token = null; this.refreshToken = null; }

  private async call(method: "GET" | "POST", path: string, { query, form, jsonBody, auth = true }: { query?: Record<string, unknown>; form?: Record<string, unknown>; jsonBody?: unknown; auth?: boolean } = {}): Promise<Json> {
    const url = new URL(this.opts.baseUrl.replace(/\/+$/, "") + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": this.opts.acceptLanguage || "en-US" };
    let body: string | undefined;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null) p.set(k, typeof v === "string" ? v : JSON.stringify(v));
      body = p.toString();
    }
    if (jsonBody !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(jsonBody); }
    if (auth) headers.Authorization = `Bearer ${await this.getToken()}`;

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000), redirect: "error" });
    } catch (e) {
      throw new HdaError(`HDA could not be reached (${(e as { name?: string }).name === "TimeoutError" ? "timeout" : "network error"}). Check the VPN or corporate network.`, { path });
    }
    const text = await res.text();
    let json: Json;
    try { json = JSON.parse(text) as Json; } catch {
      const hint = res.status === 404 ? " HDA could not be reached: connect to the company VPN or network, then try again." : "";
      throw new HdaError(`HDA returned a non-JSON answer (${res.status}) for ${path}.${hint}`, { status: res.status, path });
    }
    if (res.status === 401 && auth && !this.retrying) {
      this.token = null; this.retrying = true;
      try { return await this.call(method, path, { query, form, jsonBody, auth }); } finally { this.retrying = false; }
    }
    const code = json.result?.code !== undefined ? String(json.result.code) : undefined;
    if (!res.ok || json.success === false || (code !== undefined && code !== "0")) {
      throw new HdaError(`HDA error on ${path}: ${json.result?.desc || json.result?.subcode || res.status}`, { status: res.status, path, result: json.result });
    }
    return json;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    if (this.authBlocked) throw new HdaError(`HDA sign-in paused: ${this.authBlocked.message}`, { authBlocked: true });
    try { return await this.signIn(); }
    catch (e) {
      if (e instanceof HdaError && !e.info.authBlocked && (e.info.result || [400, 401, 403].includes(e.info.status ?? 0))) {
        this.authBlocked = { at: new Date(), message: `HDA rejected the sign-in for "${this.opts.username || "the API user"}". Synora stopped trying so the account isn't locked.` };
      }
      throw e;
    }
  }

  private async signIn(): Promise<string> {
    const o = this.opts;
    if (this.refreshToken && o.apiKey) {
      try { return this.store(await this.call("POST", "/Authentication/RefreshToken", { auth: false, form: { apikey: o.apiKey, token: this.refreshToken } })); }
      catch { this.refreshToken = null; }
    }
    let json: Json;
    if (o.authMode === "login") json = await this.call("POST", "/Authentication/LoginEx", { auth: false, jsonBody: { username: o.username, password: o.password } });
    else json = await this.call("POST", "/Authentication/Token", { auth: false, form: { ApiKey: o.apiKey, TokenMode: o.authMode === "trusted" ? "trusted" : "apikey", Username: o.username, SourceApplication: o.sourceApplication } });
    return this.store(json);
  }

  private store(json: Json): string {
    if (!json.requestToken) throw new HdaError("HDA sign-in returned no token.", { result: json.result });
    this.token = json.requestToken;
    this.refreshToken = json.refreshToken ?? null;
    this.expiresAt = Date.now() + (Number(json.expiresIn) || 900) * 1000;
    return this.token;
  }

  projection(p: { entity: string; filter?: unknown[]; columns: string[]; names: string[]; start?: number; limit?: number; sort?: unknown[] }) {
    return this.call("GET", "/WSC/Projection", { query: { entity: p.entity, filter: p.filter?.length ? p.filter : undefined, columnExpressions: p.columns, columnNames: p.names, start: p.start ?? 0, limit: p.limit ?? 200, sort: p.sort } });
  }
  get(entity: string, id: string) { return this.call("GET", "/WSC/Get", { query: { entity, id } }); }
  metabase(entity: string) { return this.call("GET", "/WSC/GetMetabase", { query: { entity } }); }
}

const decodeEntities = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, "&");

/** HDA sometimes returns HTML encoded twice; decode once so tags can be removed. */
export function stripHtml(html: unknown): string {
  if (!html) return "";
  let s = String(html);
  if (/&lt;\s*\/?\s*[a-z]/i.test(s)) s = decodeEntities(s);
  s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "");
  return decodeEntities(s).replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n\s*\n+/g, "\n").trim();
}

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const ms = /\/Date\((\d+)/.exec(String(v));
  const d = ms ? new Date(Number(ms[1])) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
