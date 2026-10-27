import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "@/lib/auth/session-cookie";

/** The pending Microsoft 365 sign-in: who started it, for which connector, and the PKCE verifier. 10 minutes. */
export interface PendingM365 { uid: string; connectorId: string; verifier: string; state: string; exp: number }
export const M365_COOKIE = "synora_m365";
export const M365_COOKIE_PATH = "/api/connectors/m365";

const sign = (body: string) => createHmac("sha256", sessionSecret()).update(`m365.${body}`).digest();

export function sealPending(p: PendingM365): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${sign(body).toString("base64url")}`;
}

export function readPending(raw: string | undefined): PendingM365 | null {
  const [body, sig] = (raw ?? "").split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = sign(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as PendingM365;
  return p.exp > Date.now() ? p : null;
}
