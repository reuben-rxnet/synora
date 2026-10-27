// Query understanding without AI: references, error codes, applications and keyword terms.
import { extractErrorCodes } from "@/lib/ingest";

const STOP = new Set(("a an the and or of to in on for with we have has this that these those is are was were be been after before again what which show " +
  "find me our any all about from by do does did how why when where it its as at but begin few hours work works can could should would there their " +
  "seen previous known please give list tell get got also not only into than then them they you your i my il la le les de des du et un une der die das und").split(" "));

// HDA tickets (A3415102L), Azure DevOps work items as WI-207077 or with their type code (US_207077, SR_59418), and other prefixed ids.
const REF = /\b(?:[A-Z]\d{6,8}[A-Z]|(?:BUG|WI|KB|INC|REQ|HR|FIN|DEV)-[A-Z0-9-]+|[A-Z]{1,4}_\d{3,7})\b/g;

/** Work item numbers named in references (WI-207077, US_207077…), matched by id whatever type code was typed. */
export const workItemIds = (refs: string[]) => [...new Set(refs.map((r) => /^(?:WI-|[A-Z]{1,4}_)(\d{3,7})$/.exec(r)?.[1]).filter((x): x is string => !!x))];

export interface ParsedQuery {
  text: string;
  terms: string[];
  refs: string[];
  errorCodes: string[];
  applications: string[];
}

export function parseQuery(text: string, aliases: { alias: string; application: string }[] = []): ParsedQuery {
  const lower = text.toLowerCase();
  const terms = [...new Set((lower.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? []).map((t) => t.replace(/[._-]+$/, "")).filter((t) => t.length > 2 && !STOP.has(t)))].slice(0, 24);
  const applications = [...new Set(aliases.filter((a) => new RegExp(`(^|[^a-z0-9])${a.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower)).map((a) => a.application))];
  return { text: text.trim(), terms, refs: [...new Set(text.toUpperCase().match(REF) ?? [])], errorCodes: extractErrorCodes(text), applications };
}

/** An OR query over the terms, for to_tsquery('simple', …). Only letters and digits reach SQL. */
export function tsQuery(terms: string[]): string | null {
  const safe = terms.map((t) => t.replace(/[^\p{L}\p{N}]+/gu, " ").trim()).filter(Boolean).flatMap((t) => t.split(" ")).filter((t) => t.length > 1);
  return safe.length ? [...new Set(safe)].map((t) => `${t}:*`).join(" | ") : null;
}
