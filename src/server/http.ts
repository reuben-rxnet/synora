import "server-only";
import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/access";
import { AuthError } from "@/lib/auth/session";

/** Wraps a route handler: typed errors become clean JSON responses; nothing internal leaks to the client. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message, code: e.code }, { status: 401 });
      if (e instanceof AuthorizationError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
      if (e instanceof RequestError) return NextResponse.json({ error: e.message, code: "BAD_REQUEST" }, { status: e.status });
      console.error("[api]", e);
      return NextResponse.json({ error: "Something went wrong. Try again in a minute.", code: "INTERNAL" }, { status: 500 });
    }
  };
}

export class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
