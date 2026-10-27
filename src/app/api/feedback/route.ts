import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { handle, RequestError } from "@/server/http";

export const dynamic = "force-dynamic";

const body = z.object({ answerId: z.string(), helpful: z.boolean(), reason: z.string().max(200).optional() });

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new RequestError("Invalid feedback.");
  // Only the person who asked can rate the answer.
  const answer = await db.answer.findFirst({ where: { id: p.data.answerId, search: { userId: session.user.id } } });
  if (!answer) throw new RequestError("Not found.", 404);
  await db.feedback.upsert({
    where: { answerId_userId: { answerId: answer.id, userId: session.user.id } },
    update: { helpful: p.data.helpful, reason: p.data.reason ?? null },
    create: { answerId: answer.id, userId: session.user.id, helpful: p.data.helpful, reason: p.data.reason ?? null },
  });
  return NextResponse.json({ ok: true });
});
