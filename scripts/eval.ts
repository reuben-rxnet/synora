// Retrieval evaluation: npm run eval [-- --refresh] [-- --label after-change]
//   * The query set is generated from the indexed corpus once and saved to eval/queries.json, so runs are
//     comparable. --refresh regenerates it (do that only when the corpus changed a lot, and say so).
//   * Every query knows which records are relevant, so the metrics need no human labels:
//       exact-ref     the record's reference (A3415102L, WI-206985) → that record, ideally first
//       title         the record's title → that record (records with the same title count as relevant too)
//       description   the first words of its description → that record
//       error-code    an error code → every record carrying that code
//       permission    a record the evaluation user may not open → must never be returned
//       abstain       a question nothing in the corpus answers → no supported evidence
//   * The evaluation user can search every non-restricted space and belongs to no source group, like a typical
//     employee; restricted spaces and group-only records are therefore out of bounds for it.
// Answer quality (faithfulness, citation precision, helpfulness) needs labelled answers or a judged review and
// is not measured here; see the README.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { principalsFor } from "../src/lib/access";
import { parseQuery } from "../src/lib/search/query";
import { retrieve, type Hit } from "../src/lib/search/retrieve";
import { hasEnoughEvidence, isSupported, type Evidence } from "../src/lib/search/answer";
import { selectEvidence, sourceGroup } from "../src/lib/search/evidence";

type Kind = "exact-ref" | "title" | "description" | "error-code" | "permission" | "abstain";
interface Case { kind: Kind; query: string; relevant: string[]; forbidden?: string[] }

const args = process.argv.slice(2);
const label = args[args.indexOf("--label") + 1] && args.includes("--label") ? args[args.indexOf("--label") + 1]! : "run";
const dir = join(process.cwd(), "eval");
const setFile = join(dir, "queries.json");

// Deterministic pseudo-random choice, so a regenerated set is the same for the same corpus.
let seed = 20261027;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[], n: number) => { const c = xs.slice(); const out: T[] = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]!); return out; };

const ABSTAIN = [
  "What is the cafeteria menu for next Tuesday?", "How many vacation days do I have left this year?", "Who won the football world cup in 1998?",
  "Translate good morning into Japanese", "What is the boiling point of nitrogen?", "Recommend a good science fiction novel",
  "What is the stock price of a random company today?", "How do I bake sourdough bread at home?", "What time does the Paris metro close?",
  "Plan a hiking trip in the Alps for three days", "What is the capital of Australia?", "Explain the rules of cricket",
  "Write a poem about autumn leaves", "Which planet has the most moons?", "Suggest names for a pet goldfish",
];

async function buildSet(evalSpaceIds: string[]): Promise<Case[]> {
  const visible = { deletedAt: null, spaceId: { in: evalSpaceIds }, sensitivity: { not: "restricted" } };
  const pool = await db.sourceRecord.findMany({ where: visible, select: { id: true, ref: true, title: true, body: true, sourceSystem: true, errorCodes: true } });
  const bySource = (s: (r: (typeof pool)[number]) => boolean) => pool.filter(s);
  const cases: Case[] = [];
  const refLike = (r: (typeof pool)[number]) => /^(?:[A-Z]\d{6,8}[A-Z]|WI-\d+|BUG-\d+|KB-\S+|INC-\S+)$/.test(r.ref);
  // exact-ref: 60, spread over HDA and Azure DevOps
  for (const r of [...pick(bySource((x) => x.sourceSystem === "HDA Ticketing" && refLike(x)), 30), ...pick(bySource((x) => x.sourceSystem === "Azure DevOps" && refLike(x)), 30)]) cases.push({ kind: "exact-ref", query: r.ref, relevant: [r.id] });
  // title: 60, every source present first, then topped up from the large ones
  const sources = [...new Set(pool.map((r) => r.sourceSystem))];
  const titledPool = pool.filter((x) => x.title.length > 12);
  const firsts = sources.flatMap((s) => pick(titledPool.filter((x) => x.sourceSystem === s), 4));
  const titled = [...firsts, ...pick(titledPool.filter((x) => !firsts.includes(x)), 60 - firsts.length)].slice(0, 60);
  for (const r of titled) {
    const same = pool.filter((x) => x.title.trim().toLowerCase() === r.title.trim().toLowerCase()).map((x) => x.id);
    cases.push({ kind: "title", query: r.title.replace(/^[A-Z]{1,4}_\d+\s*[:-]\s*/, ""), relevant: same });
  }
  // description: 50
  for (const r of pick(bySource((x) => x.body.split(/\s+/).length > 20), 50)) {
    const words = r.body.replace(/^.*\n\n/, "").split(/\s+/).filter(Boolean).slice(0, 14).join(" ");
    cases.push({ kind: "description", query: words, relevant: [r.id] });
  }
  // error-code: 20
  const codes = [...new Set(pool.flatMap((r) => r.errorCodes))];
  for (const code of pick(codes, 20)) cases.push({ kind: "error-code", query: code, relevant: pool.filter((r) => r.errorCodes.includes(code)).map((r) => r.id) });
  // permission: every out-of-bounds record by ref, title and description
  const forbidden = await db.sourceRecord.findMany({ where: { deletedAt: null, OR: [{ spaceId: { notIn: evalSpaceIds } }, { sensitivity: "restricted" }] }, select: { id: true, ref: true, title: true, body: true } });
  for (const r of forbidden) for (const query of [r.ref, r.title, r.body.split(/\s+/).slice(0, 14).join(" ")]) cases.push({ kind: "permission", query, relevant: [], forbidden: [r.id] });
  for (const query of ABSTAIN) cases.push({ kind: "abstain", query, relevant: [] });
  return cases;
}

const dcg = (rels: number[]) => rels.reduce((s, r, i) => s + r / Math.log2(i + 2), 0);
const pct = (xs: number[], p: number) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };

async function main() {
  const spaces = await db.space.findMany({ where: { visibility: { not: "restricted" } } });
  const principals = principalsFor({ userId: "eval-user", spaceIds: spaces.map((s) => s.id), groupKeys: [] });
  mkdirSync(dir, { recursive: true });
  if (!existsSync(setFile) || args.includes("--refresh")) writeFileSync(setFile, JSON.stringify(await buildSet(spaces.map((s) => s.id)), null, 1));
  const cases = JSON.parse(readFileSync(setFile, "utf8")) as Case[];
  const aliases = await db.applicationAlias.findMany();
  const source = new Map((await db.sourceRecord.findMany({ select: { id: true, sourceSystem: true, title: true, evidenceKind: true, raw: true } })).map((r) => [r.id, r]));
  const sourceOf = (id: string) => { const r = source.get(id); return r ? sourceGroup({ sourceSystem: r.sourceSystem, demo: (r.raw as { demo?: boolean } | null)?.demo === true }) : "?"; };

  await retrieve(parseQuery("warm up the embedding model", aliases), principals, {}, 5); // first call loads the model
  const rows: { c: Case; ranked: string[]; ms: number; hits: Hit[]; evidence: Hit[] }[] = [];
  for (const c of cases) {
    const t = Date.now();
    const hits = await retrieve(parseQuery(c.query, aliases), principals, {}, 30);
    rows.push({ c, ranked: hits.map((h) => h.recordId), ms: Date.now() - t, hits, evidence: selectEvidence(hits, sourceOf) });
  }

  const ret = rows.filter((r) => r.c.relevant.length);
  const at = (r: (typeof rows)[number], k: number) => r.ranked.slice(0, k).filter((id) => r.c.relevant.includes(id)).length;
  const metrics = (subset: typeof ret) => {
    const n = subset.length || 1;
    const recall = (k: number) => subset.reduce((s, r) => s + at(r, k) / Math.min(r.c.relevant.length, k), 0) / n;
    const precision = (k: number) => subset.reduce((s, r) => s + at(r, k) / k, 0) / n;
    const mrr = subset.reduce((s, r) => { const i = r.ranked.findIndex((id) => r.c.relevant.includes(id)); return s + (i >= 0 ? 1 / (i + 1) : 0); }, 0) / n;
    const ndcg = subset.reduce((s, r) => { const rels = r.ranked.slice(0, 10).map((id) => (r.c.relevant.includes(id) ? 1 : 0)); const ideal = dcg(Array(Math.min(10, r.c.relevant.length)).fill(1)); return s + (ideal ? dcg(rels) / ideal : 0); }, 0) / n;
    return { n: subset.length, recall5: recall(5), recall10: recall(10), precision5: precision(5), precision10: precision(10), mrr, ndcg10: ndcg };
  };
  const exact = rows.filter((r) => r.c.kind === "exact-ref");
  const dupRate = rows.reduce((s, r) => { const titles = r.ranked.slice(0, 10).map((id) => source.get(id)?.title.trim().toLowerCase()); return s + titles.filter((t, i) => titles.indexOf(t) !== i).length / Math.max(1, titles.length); }, 0) / rows.length;
  const leaks = rows.filter((r) => r.c.forbidden?.some((id) => r.ranked.includes(id)));
  const abstain = rows.filter((r) => r.c.kind === "abstain");
  const toEvidence = (h: Hit) => ({ ...h, id: "", ref: "", sourceSystem: "", recordType: "", title: "", status: null, application: null, rootCause: null, resolution: null, updatedAt: null, evidenceKind: source.get(h.recordId)?.evidenceKind ?? "" }) as Evidence;
  const abstained = abstain.filter((r) => !hasEnoughEvidence(r.evidence.map(toEvidence)));
  const answerable = rows.filter((r) => r.c.kind === "description" || r.c.kind === "title");
  const answered = answerable.filter((r) => hasEnoughEvidence(r.evidence.map(toEvidence)));
  // The previous support rule (similarity ≥ 0.83 or any 2 matching terms), scored on the same data in the same
  // run, so the comparison isn't confounded by the index changing between runs.
  const legacySupported = (h: Hit) => h.exactRef || h.similarity >= 0.83 || h.matchedTerms >= 2;
  const legacyEnough = (hs: Hit[]) => { const s = hs.filter(legacySupported); return s.length >= 2 || s.some((h) => h.exactRef || source.get(h.recordId)?.evidenceKind === "approved"); };
  const legacy = { abstainCorrect: abstain.filter((r) => !legacyEnough(r.hits.slice(0, 8))).length / Math.max(1, abstain.length), answerable: answerable.filter((r) => legacyEnough(r.hits.slice(0, 8))).length / Math.max(1, answerable.length) };
  const diversity = rows.filter((r) => r.evidence.some(isSupported)).map((r) => new Set(r.evidence.filter(isSupported).map((h) => sourceOf(h.recordId))).size);

  const report = {
    label, at: new Date().toISOString(), cases: rows.length,
    overall: metrics(ret),
    byKind: Object.fromEntries((["exact-ref", "title", "description", "error-code"] as Kind[]).map((k) => [k, metrics(ret.filter((r) => r.c.kind === k))])),
    exactRefFirst: exact.filter((r) => r.c.relevant.includes(r.ranked[0] ?? "")).length / Math.max(1, exact.length),
    duplicateRateTop10: dupRate,
    permissionLeaks: leaks.length, permissionCases: rows.filter((r) => r.c.kind === "permission").length,
    abstainCorrect: abstained.length / Math.max(1, abstain.length),
    answerableWithEnoughEvidence: answered.length / Math.max(1, answerable.length),
    evidenceSourcesPerAnswer: diversity.reduce((s, x) => s + x, 0) / Math.max(1, diversity.length),
    legacySupportRule: legacy,
    corpus: await db.sourceRecord.count({ where: { deletedAt: null } }),
    latencyMs: { p50: pct(rows.map((r) => r.ms), 50), p95: pct(rows.map((r) => r.ms), 95) },
  };
  const f = (x: number) => x.toFixed(3);
  console.log(`\nSynora retrieval evaluation (${label}): ${rows.length} queries\n`);
  console.log("kind          n    R@5    R@10   P@5    P@10   MRR    NDCG@10");
  for (const [k, m] of [["overall", report.overall], ...Object.entries(report.byKind)] as [string, ReturnType<typeof metrics>][]) console.log(`${k.padEnd(12)} ${String(m.n).padStart(3)}  ${f(m.recall5)}  ${f(m.recall10)}  ${f(m.precision5)}  ${f(m.precision10)}  ${f(m.mrr)}  ${f(m.ndcg10)}`);
  console.log(`\nexact reference ranked first   ${f(report.exactRefFirst)}`);
  console.log(`duplicate titles in top 10     ${f(report.duplicateRateTop10)}`);
  console.log(`permission leaks               ${report.permissionLeaks} of ${report.permissionCases} checks`);
  console.log(`abstained when it should       ${f(report.abstainCorrect)}   (previous rule, same data: ${f(legacy.abstainCorrect)})`);
  console.log(`answerable with enough evidence ${f(report.answerableWithEnoughEvidence)}   (previous rule, same data: ${f(legacy.answerable)})`);
  console.log(`records in the index           ${report.corpus}`);
  console.log(`sources per answer (evidence)  ${report.evidenceSourcesPerAnswer.toFixed(2)}`);
  console.log(`retrieval latency              p50 ${report.latencyMs.p50} ms · p95 ${report.latencyMs.p95} ms`);
  writeFileSync(join(dir, `result-${label}.json`), JSON.stringify(report, null, 1));
  await db.$disconnect();
}
void main();
