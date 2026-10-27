import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePageSession } from "@/lib/auth/session";
import { SimilarClient } from "@/components/similar";

export const metadata: Metadata = { title: "Similar Issues" };
export const dynamic = "force-dynamic";

export default async function SimilarPage({ searchParams }: PageProps<"/similar">) {
  const s = await requirePageSession();
  const sp = await searchParams;
  const sources = await db.sourceRecord.groupBy({ by: ["sourceSystem"], where: { deletedAt: null, acl: { hasSome: s.principals }, recordType: { in: ["incident", "request", "problem", "bug", "chat", "email"] } } });
  return <SimilarClient initialQuery={typeof sp.q === "string" ? sp.q : ""} sourceSystems={sources.map((x) => x.sourceSystem)} />;
}
