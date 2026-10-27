// Creates the indexes Prisma can't express: HNSW on embeddings, GIN on full text and permissions,
// and a trigger that keeps Chunk.tsv in step with Chunk.text. Safe to run repeatedly.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const statements = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw ON "Chunk" USING hnsw (embedding vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS chunk_tsv_gin ON "Chunk" USING gin (tsv)`,
  `CREATE INDEX IF NOT EXISTS record_acl_gin ON "SourceRecord" USING gin (acl)`,
  `CREATE INDEX IF NOT EXISTS record_ref_trgm ON "SourceRecord" USING gin (ref gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS record_title_trgm ON "SourceRecord" USING gin (title gin_trgm_ops)`,
  `CREATE OR REPLACE FUNCTION chunk_tsv_update() RETURNS trigger AS $$
   BEGIN NEW.tsv := to_tsvector('simple', coalesce(NEW.text, '')); RETURN NEW; END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS chunk_tsv_trigger ON "Chunk"`,
  `CREATE TRIGGER chunk_tsv_trigger BEFORE INSERT OR UPDATE OF text ON "Chunk" FOR EACH ROW EXECUTE FUNCTION chunk_tsv_update()`,
];

for (const sql of statements) await db.$executeRawUnsafe(sql);
console.log(`Indexes ready (${statements.length} statements).`);
await db.$disconnect();
