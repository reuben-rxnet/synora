import { PrismaClient } from "@prisma/client";

// One client per process; Next.js dev reloads modules, so it is kept on globalThis there.
const g = globalThis as unknown as { synoraDb?: PrismaClient };
export const db = g.synoraDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.synoraDb = db;
