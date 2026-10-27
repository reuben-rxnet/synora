// Prints what retrieval returns for a person: npx tsx --env-file=.env scripts/try-retrieve.ts <email> "<query>" ...
import { db } from "../src/lib/db";
import { parseQuery } from "../src/lib/search/query";
import { retrieve } from "../src/lib/search/retrieve";
import { principalsFor } from "../src/lib/access";

const email = process.argv[2]!;
const u = await db.user.findUniqueOrThrow({ where: { email }, include: { spaces: true, groups: { include: { group: true } } } });
const principals = principalsFor({ userId: u.id, spaceIds: u.spaces.map((s) => s.spaceId), groupKeys: u.groups.map((g) => g.group.key) });
const aliases = await db.applicationAlias.findMany();
for (const q of process.argv.slice(3)) {
  const hits = await retrieve(parseQuery(q, aliases), principals);
  const recs = await db.sourceRecord.findMany({ where: { id: { in: hits.map((h) => h.recordId) } }, select: { id: true, ref: true } });
  console.log("\nQ:", q);
  for (const h of hits.slice(0, 6)) console.log(" ", (recs.find((r) => r.id === h.recordId)?.ref ?? "?").padEnd(16), "sim", h.similarity.toFixed(3), "kw", h.matchedTerms, "score", h.score.toFixed(4));
}
await db.$disconnect();
