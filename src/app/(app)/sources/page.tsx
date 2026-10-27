import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { SourcesClient } from "@/components/sources";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const s = await requirePageSession();
  if (!s.permissions.has("connectors.view")) redirect("/");
  return <SourcesClient />;
}
