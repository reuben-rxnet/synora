import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/demo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/sign-in", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
