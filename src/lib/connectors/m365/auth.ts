// Microsoft 365 sign-in for the SharePoint & OneDrive connector (delegated: Synora reads what the person who
// connected it can read, nothing more).
//   * Authorization code + PKCE against the tenant's Entra ID, with the scopes below. The app registration can be
//     the one used for Synora sign-in (ENTRA_*) or a separate one (M365_*), with the redirect URI
//     <APP_BASE_URL>/api/connectors/m365/callback.
//   * The refresh token is kept encrypted (AES-256-GCM) in the Setting table, never in the connector config, so
//     it isn't sent to the browser. The sync worker uses it to get short-lived access tokens; Microsoft rotates it
//     on every refresh and the new one is saved.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sessionSecret } from "@/lib/auth/session-cookie";
import { ConnectorError } from "../types";

export const M365_SCOPES = "offline_access openid profile User.Read Files.Read.All Sites.Read.All";

export interface M365Config { tenantId: string; clientId: string; clientSecret: string; redirectUri: string }
export function m365Config(env: Record<string, string | undefined> = process.env): M365Config {
  const pick = (k: string) => (env[`M365_${k}`] || env[`ENTRA_${k}`] || "").trim();
  const tenantId = pick("TENANT_ID"), clientId = pick("CLIENT_ID"), clientSecret = pick("CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) {
    throw new ConnectorError("NOT_CONFIGURED", "The Microsoft 365 app registration isn't set up yet: set M365_TENANT_ID, M365_CLIENT_ID and M365_CLIENT_SECRET (or the ENTRA_ ones) in .env. See README → SharePoint & OneDrive.");
  }
  const base = (env.APP_BASE_URL || "http://localhost:3020").replace(/\/+$/, "");
  return { tenantId, clientId, clientSecret, redirectUri: `${base}/api/connectors/m365/callback` };
}

const authority = (c: M365Config) => `https://login.microsoftonline.com/${encodeURIComponent(c.tenantId)}/oauth2/v2.0`;

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(c: M365Config, state: string, challenge: string, loginHint?: string): string {
  const u = new URL(`${authority(c)}/authorize`);
  u.search = new URLSearchParams({
    client_id: c.clientId, response_type: "code", redirect_uri: c.redirectUri, response_mode: "query", scope: M365_SCOPES,
    state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account", ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.href;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
async function tokenRequest(c: M365Config, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authority(c)}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, scope: M365_SCOPES, ...params }),
  }).catch(() => { throw new ConnectorError("UNREACHABLE", "Microsoft sign-in could not be reached.", true); });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const why = json.error_description?.split(/\r?\n/)[0] ?? json.error ?? String(res.status);
    // invalid_grant: the sign-in expired or was revoked (password change, admin, 90 days unused).
    throw new ConnectorError("AUTH", json.error === "invalid_grant" ? "The Microsoft 365 sign-in has expired or was revoked. Sign in to Microsoft 365 again on the Sources page." : `Microsoft refused the sign-in: ${why}`);
  }
  return json;
}
export const exchangeCode = (c: M365Config, code: string, verifier: string) => tokenRequest(c, { grant_type: "authorization_code", code, redirect_uri: c.redirectUri, code_verifier: verifier });

// ---- encrypted credential storage ----
export interface M365Credential { refreshToken: string; account: { name: string; upn: string }; savedAt: string }
const settingKey = (connectorId: string) => `credential:m365:${connectorId}`;
const key = () => createHash("sha256").update(`synora-credential:${process.env.CREDENTIAL_ENCRYPTION_KEY || sessionSecret()}`).digest();

export function seal(value: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
export function unseal(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(data!), d.final()]).toString("utf8");
}

export async function saveCredential(connectorId: string, cred: M365Credential, actorId?: string) {
  const value = { sealed: seal(JSON.stringify(cred)) };
  await db.setting.upsert({ where: { key: settingKey(connectorId) }, update: { value, updatedBy: actorId }, create: { key: settingKey(connectorId), value, updatedBy: actorId } });
}
export async function loadCredential(connectorId: string): Promise<M365Credential | null> {
  const s = await db.setting.findUnique({ where: { key: settingKey(connectorId) } });
  const sealed = (s?.value as { sealed?: string } | null)?.sealed;
  if (!sealed) return null;
  try { return JSON.parse(unseal(sealed)) as M365Credential; } catch { return null; } // key changed: sign in again
}
export async function deleteCredential(connectorId: string) { await db.setting.deleteMany({ where: { key: settingKey(connectorId) } }); }

const tokens = new Map<string, { token: string; expiresAt: number }>();
/** A Graph access token for the connector, refreshed (and the rotated refresh token saved) when needed. */
export async function accessToken(connectorId: string): Promise<string> {
  const cached = tokens.get(connectorId);
  if (cached && Date.now() < cached.expiresAt - 120_000) return cached.token;
  const cred = await loadCredential(connectorId);
  if (!cred) throw new ConnectorError("AUTH", "Nobody has signed in to Microsoft 365 for this connector yet. Choose Sign in to Microsoft 365 on the Sources page.");
  const t = await tokenRequest(m365Config(), { grant_type: "refresh_token", refresh_token: cred.refreshToken });
  if (t.refresh_token && t.refresh_token !== cred.refreshToken) await saveCredential(connectorId, { ...cred, refreshToken: t.refresh_token, savedAt: new Date().toISOString() });
  tokens.set(connectorId, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}
export const forgetToken = (connectorId: string) => tokens.delete(connectorId);
