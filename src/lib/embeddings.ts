import path from "node:path";
import { getDb } from "./db";

// multilingual-e5-small: 384-dim sentence embeddings, EN+RU friendly,
// quantized ONNX weights (~120MB) cached under DATA_DIR/models.
const MODEL = "Xenova/multilingual-e5-small";

export const EMBEDDING_DIM = 384;

type Embedder = (texts: string[]) => Promise<Float32Array[]>;

let embedderPromise: Promise<Embedder> | null = null;

function getEmbedder(): Promise<Embedder> {
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
    env.cacheDir = path.join(dataDir, "models");
    const extractor = await pipeline("feature-extraction", MODEL, {
      dtype: "q8",
    });
    return async (texts: string[]) => {
      const output = await extractor(texts, {
        pooling: "mean",
        normalize: true,
      });
      const flat = output.data as Float32Array;
      return texts.map((_, i) =>
        new Float32Array(flat.buffer, flat.byteOffset + i * EMBEDDING_DIM * 4, EMBEDDING_DIM).slice()
      );
    };
  })();
  embedderPromise.catch(() => {
    // Allow a retry after transient failures (e.g. first-run download offline).
    embedderPromise = null;
  });
  return embedderPromise;
}

function articleText(title: string, summary: string | null): string {
  // e5 models expect a "passage: " prefix for indexed documents.
  return `passage: ${`${title}. ${summary ?? ""}`.slice(0, 512)}`;
}

export function bufferToVector(buffer: Buffer): Float32Array {
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / 4
  );
}

let backfillRunning = false;

// Embed articles that don't have a vector yet, newest first. Fire-and-forget:
// callers never await feed refresh on model work.
export async function backfillEmbeddings(limit = 100): Promise<number> {
  if (backfillRunning) return 0;
  backfillRunning = true;
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, title, summary FROM articles
         WHERE embedding IS NULL
         ORDER BY published_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ id: number; title: string; summary: string | null }>;
    if (rows.length === 0) return 0;

    const embed = await getEmbedder();
    const update = db.prepare("UPDATE articles SET embedding = ? WHERE id = ?");
    const BATCH = 16;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const vectors = await embed(
        batch.map((row) => articleText(row.title, row.summary))
      );
      for (let j = 0; j < batch.length; j++) {
        update.run(Buffer.from(vectors[j].buffer), batch[j].id);
      }
    }
    return rows.length;
  } catch (error) {
    console.error("[embeddings] backfill failed:", error);
    return 0;
  } finally {
    backfillRunning = false;
  }
}
