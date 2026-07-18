// Print proposed tags for a sample of articles so the vocabulary and
// thresholds in src/lib/tags.ts can be tuned by eye.
// Usage: DATA_DIR=<dir with magshorts.db + models> npx tsx scripts/calibrate-tags.ts [sample-per-feed]
import { getDb } from "../src/lib/db";
import { bufferToVector } from "../src/lib/embeddings";
import { assignTags, scoreTags } from "../src/lib/tags";

const showScores = process.env.SCORES === "1";

const perFeed = Number(process.argv[2] ?? 3);

async function main() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.summary, a.embedding, f.title AS feed
       FROM articles a JOIN feeds f ON f.id = a.feed_id
       WHERE a.embedding IS NOT NULL
         AND a.id IN (
           SELECT id FROM articles a2
           WHERE a2.feed_id = a.feed_id AND a2.embedding IS NOT NULL
           ORDER BY a2.published_at DESC LIMIT ?
         )
       ORDER BY f.title, a.published_at DESC`
    )
    .all(perFeed) as Array<{
    id: number;
    title: string;
    summary: string | null;
    embedding: Buffer;
    feed: string;
  }>;

  for (const row of rows) {
    const tags = await assignTags(
      bufferToVector(row.embedding),
      `${row.title}. ${row.summary ?? ""}`
    );
    console.log(
      `[${row.feed.slice(0, 18).padEnd(18)}] ${
        tags.length ? tags.join(", ").padEnd(28) : "—".padEnd(28)
      } ${row.title.slice(0, 78)}`
    );
    if (showScores) {
      const scores = await scoreTags(bufferToVector(row.embedding));
      console.log(
        "    " +
          scores
            .slice(0, 5)
            .map((s) => `${s.slug}:${s.score.toFixed(3)}`)
            .join("  ")
      );
    }
  }
}

main();
