// Ad-hoc: full score stats for articles matching a title substring.
import { getDb } from "../src/lib/db";
import { bufferToVector } from "../src/lib/embeddings";
import { scoreTags } from "../src/lib/tags";

async function main() {
  const needle = process.argv[2] ?? "emoji";
  const rows = getDb()
    .prepare(
      `SELECT title, summary, embedding FROM articles
       WHERE embedding IS NOT NULL AND title LIKE '%' || ? || '%' LIMIT 5`
    )
    .all(needle) as Array<{ title: string; summary: string | null; embedding: Buffer }>;
  for (const row of rows) {
    const scores = await scoreTags(bufferToVector(row.embedding));
    const mean = scores.reduce((s, e) => s + e.score, 0) / scores.length;
    console.log(`\n${row.title}`);
    console.log(`mean=${mean.toFixed(3)} top-8:`);
    console.log(
      scores.slice(0, 8).map((s) => `${s.slug}:${s.score.toFixed(3)} (+${(s.score - mean).toFixed(3)})`).join("  ")
    );
  }
}
main();
