import { z } from "zod";
import { requireSession, assertPermission } from "@/lib/auth/session";
import { runSearch } from "@/lib/search/pipeline";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

const body = z.object({
  query: z.string().trim().min(2, "Type at least two characters.").max(4000),
  mode: z.enum(["ask", "records", "similar", "investigate"]).default("ask"),
  filters: z.object({
    spaces: z.array(z.string()).max(50).optional(),
    sourceSystems: z.array(z.string()).max(20).optional(),
    applications: z.array(z.string()).max(50).optional(),
    recordTypes: z.array(z.string()).max(20).optional(),
    statuses: z.array(z.string()).max(20).optional(),
    evidenceKinds: z.array(z.string()).max(10).optional(),
    updatedWithinDays: z.number().int().positive().max(3650).nullable().optional(),
  }).default({}),
});

/** Streams search events as newline-delimited JSON. */
export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new RequestError(parsed.error.issues[0]?.message ?? "Invalid search.");
  if (parsed.data.mode === "investigate") assertPermission(session, "investigate"); else assertPermission(session, "search");
  // Space filters can only narrow to spaces the person belongs to.
  const mine = new Set(session.spaces.map((s) => s.id));
  const filters = { ...parsed.data.filters, spaces: parsed.data.filters.spaces?.filter((s) => mine.has(s)) };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of runSearch(session, { ...parsed.data, filters })) controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        console.error("[search]", e);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: "Search service unavailable. Your question was not lost; try again in a minute." }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
});
