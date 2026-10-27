import { db } from "@/lib/db";
import { requirePageSession } from "@/lib/auth/session";
import { SearchClient } from "@/components/search";

export const dynamic = "force-dynamic";

const SUGGESTIONS: Record<string, string[]> = {
  "it-support": [
    "RxCNC connections work after a server restart but begin timing out again after a few hours.",
    "What are the most common order-launch failures?",
    "Summarize the known fixes for print-queue failures.",
    "Show previous solutions for API timeout incidents.",
  ],
  development: ["How is the RxCNC dispatcher connection pool tuned?", "Which bugs are linked to RxCNC timeout incidents?"],
  hr: ["How do I request parental leave?", "Why would a payslip be missing in Workday?"],
  finance: ["How do we reconcile intercompany balances at month-end?", "The FX revaluation run failed with a missing rate. What do we do?"],
};

export default async function SearchPage({ searchParams }: PageProps<"/">) {
  const s = await requirePageSession();
  const sp = await searchParams;
  const [recent, facets] = await Promise.all([
    db.search.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "desc" }, take: 8, select: { query: true, mode: true, createdAt: true } }),
    db.sourceRecord.groupBy({ by: ["sourceSystem"], where: { deletedAt: null, acl: { hasSome: s.principals } }, _count: true }),
  ]);
  const suggestions = [...new Set(s.spaces.flatMap((sp) => SUGGESTIONS[sp.key] ?? []))].slice(0, 6);
  return (
    <SearchClient
      initialQuery={typeof sp.q === "string" ? sp.q : ""}
      initialMode={typeof sp.mode === "string" ? sp.mode : "ask"}
      autoRun={typeof sp.q === "string" && sp.run === "1"}
      suggestions={suggestions}
      recent={[...new Map(recent.map((r) => [r.query, { q: r.query, when: r.createdAt.toISOString() }])).values()]}
      spaces={s.spaces.map((x) => ({ id: x.id, name: x.name }))}
      sourceSystems={facets.map((f) => ({ name: f.sourceSystem, count: f._count }))}
    />
  );
}
