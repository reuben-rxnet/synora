// Checks config/hda-mapping.json against HDA: npm run hda:discover [-- --group G815L ...] [-- <extra entity> ...]
//   * signs in with the .env credentials (one attempt; a rejected sign-in is not retried)
//   * writes each entity's metabase to discover/metabase-<entity>.json (no ticket data, session token removed)
//   * reads recent solved tickets with the full mapping, the same way the sync does, and shows per field how often
//     it is filled, which expressions HDA rejected and which fell back to the raw id
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchRows, hdaClient, loadMapping, REQUIRED_COLUMNS } from "../src/lib/connectors/hda/connector";
import { secretReader } from "../src/lib/connectors/sync";

const SAMPLE = 50;
const args = process.argv.slice(2);
const groups = args.flatMap((a, i) => (args[i - 1] === "--group" ? [a] : []));
const extraEntities = args.filter((a, i) => a !== "--group" && args[i - 1] !== "--group");
const m = loadMapping();
const client = hdaClient({ connectorId: "discover", config: {}, secret: secretReader(null) }, m.requestDelayMs);
console.log(`HDA: ${process.env.HDA_BASE_URL} (auth mode: ${process.env.HDA_AUTH_MODE || "login"}, user: ${process.env.HDA_USERNAME || "-"})\n`);

function fieldNames(meta: unknown): Set<string> {
  const names = new Set<string>();
  const walk = (o: unknown, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 12) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
    const r = o as Record<string, unknown>;
    for (const k of ["Name", "FieldName", "PropertyName"]) if (typeof r[k] === "string") names.add(r[k] as string);
    Object.values(r).forEach((v) => walk(v, depth + 1));
  };
  walk(meta);
  return names;
}

const outDir = join(process.cwd(), "discover");
mkdirSync(outDir, { recursive: true });
const known = new Map<string, Set<string>>();
for (const entity of [...new Set([m.entity, m.groups.entity, m.access.entity!, ...extraEntities])]) {
  try {
    const meta = (await client.metabase(entity)) as Record<string, unknown>;
    delete meta.requestToken;
    writeFileSync(join(outDir, `metabase-${entity}.json`), JSON.stringify(meta, null, 2));
    known.set(entity, fieldNames(meta.data));
    console.log(`✔ ${entity}: ${known.get(entity)!.size} properties, saved to discover/metabase-${entity}.json`);
  } catch (e) {
    console.log(`✖ GetMetabase ${entity}: ${(e as Error).message}`);
    if (!known.size) process.exit(1); // sign-in or network failure: stop before anything else is tried
  }
}

const fields = known.get(m.entity);
const root = (expr: string) => expr.split(".")[0]!;
const unknown = [...Object.values(m.columns), ...m.fields.map((f) => f.expr)].filter((e) => fields && !fields.has(root(e)) && !fields.has(`${root(e)}ID`));
if (unknown.length) console.log(`\n⚠ Not in the ${m.entity} metabase (check the names): ${unknown.join(", ")}`);

const dropped = new Set<string>();
const rows = await fetchRows(client, m, {
  entity: m.entity, limit: SAMPLE, sort: [{ property: m.cursorProperty, direction: "DESC" }],
  filter: [{ property: m.statusProperty, op: "in", value: m.solvedStatusIds }, ...(groups.length ? [{ property: m.ownerGroupProperty, op: "in", value: groups }] : [])],
}, dropped);
console.log(`\n${rows.length} most recent solved tickets${groups.length ? ` of ${groups.join(", ")}` : ""}:`);
const line = (key: string, expr: string, label: string, required = false) => {
  const values = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== "" && v !== false);
  const examples = [...new Set(values.map((v) => String(v).replace(/\s+/g, " ").slice(0, 30)))].slice(0, 3).join(" | ");
  const flag = required && !values.length ? "  ← REQUIRED and always empty" : "";
  console.log(`   ${label.slice(0, 26).padEnd(27)} ${expr.slice(0, 32).padEnd(33)} ${String(values.length).padStart(3)}/${rows.length}  ${examples}${flag}`);
};
console.log("\n── Core columns");
for (const [k, e] of Object.entries(m.columns)) line(k, e, k, REQUIRED_COLUMNS.includes(k));
console.log("\n── Extended fields");
for (const f of m.fields) line(f.key, f.expr, `${f.label}${f.person ? " (person)" : ""}`);
if (dropped.size) console.log(`\n✖ HDA rejected these expressions; the sync skips them: ${[...dropped].join(", ")}`);
console.log("\nOptional fields may be blank. Fix flagged names in config/hda-mapping.json, then Test connection again.");
