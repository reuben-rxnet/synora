// Text embeddings (384 dimensions, matching Chunk.embedding).
//   EMBEDDING_PROVIDER=local – multilingual-e5-small running in this process (transformers.js). Content never
//                              leaves the machine, which keeps indexing outside the AI data-processing approval.
//   EMBEDDING_PROVIDER=hash  – deterministic hashed bag of words. For tests and for machines that can't download
//                              the model; similarity is lexical only.
// e5 models expect "query: " and "passage: " prefixes.

export const EMBEDDING_DIMENSIONS = 384;

export type EmbedKind = "query" | "passage";

export interface Embedder { name: string; embed(texts: string[], kind: EmbedKind): Promise<number[][]> }

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export const hashEmbedder: Embedder = {
  name: "hash",
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const tok of t.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? []) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 16777619);
        v[Math.abs(h) % EMBEDDING_DIMENSIONS]! += 1;
      }
      return normalize(v);
    });
  },
};

type Extractor = (input: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor> | null = null;

function localExtractor(): Promise<Extractor> {
  if (!extractor) {
    extractor = (async () => {
      const t = await import("@huggingface/transformers");
      t.env.cacheDir = process.env.EMBEDDING_CACHE_DIR || ".models";
      const model = process.env.EMBEDDING_MODEL || "Xenova/multilingual-e5-small";
      return (await t.pipeline("feature-extraction", model, { dtype: "q8" })) as unknown as Extractor;
    })();
    extractor.catch(() => { extractor = null; });
  }
  return extractor;
}

export const localEmbedder: Embedder = {
  name: "local",
  async embed(texts, kind) {
    const run = await localExtractor();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => `${kind}: ${t.slice(0, 2000)}`);
      out.push(...(await run(batch, { pooling: "mean", normalize: true })).tolist());
    }
    return out;
  },
};

export function embedder(): Embedder {
  return process.env.EMBEDDING_PROVIDER === "hash" ? hashEmbedder : localEmbedder;
}

/** pgvector literal for raw SQL parameters. */
export const toVector = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
