import { ARTICLE_COLUMNS, getDb, type Article } from "./db";
import { EMBEDDING_DIM, bufferToVector } from "./embeddings";
import { buildProfile, isCommerceRoundup } from "./recommend";

// What to read after this one.
//
// The reader's right rail used to hold whatever came next in the list it was
// opened from, which says nothing about the article on screen. This ranks by
// what the article is about, using the embeddings ingest already computes.
//
// The two cut-offs are measured, not guessed. Over 3 760 embedded articles from
// the last 45 days, a random pair scores median .755 and p90 .814, while real
// neighbours land at .86–.92 — the litter-box piece finds a robot-litter-box
// review, the Pixel review finds five other Pixel reviews.
//
// FLOOR sits above the *p99* of random pairs (.847), not the p90. Measured on
// the litter-box article the difference is the whole feature: the one real
// neighbour scores .873 and everything else lands in a flat .821–.831 band
// where "How to take better photos of your pets" (.8306) is indistinguishable
// from "Act faster with our new Slack integration" (.8222). A floor inside
// that band fills the rail with noise; above it, an article with one related
// piece offers one and the reader falls back to the list for the rest.
const FLOOR = 0.85;
// CEILING catches the same piece twice — a syndication, or the live blog that
// became the article. The digest's CLUSTER_THRESHOLD (.87) is deliberately not
// reused: for a digest a second take on the same story is a duplicate, for a
// next read it is often exactly what you want.
const CEILING = 0.93;
// Among equally related pieces, prefer one the reader would like — a
// tie-breaker, not a second recommender. Measured against the median random
// pair rather than used raw: e5 packs everything between .70 and .93, so a raw
// profile cosine contributes about .28 to every candidate alike and drowns the
// .11 of spread that actually separates them. Centred, it moves a score by
// about ±.03, which is what a tie-breaker should do.
const TASTE_WEIGHT = 0.35;
const RANDOM_PAIR_MEDIAN = 0.755;
// Without this the rail is several cards from whichever publication covers the
// topic most, which is what the raw ranking gives for anything Verge-shaped.
// Kept small against the .85–.93 range it competes in: a strong second card
// from the same publication should still beat a weak one from another.
const FEED_REPEAT_PENALTY = 0.02;
const COMMERCE_PENALTY = 0.08;
const WINDOW_DAYS = 45;
// The whole window, not a recent slice of it. An earlier cap of 400 took only
// the newest articles overall — a couple of days on a feed as busy as Habr —
// so the piece an article was actually about never entered the pool. Scoring
// the full window is 3 800 dot products over 384 floats; measured below a
// millisecond, against a query that already costs more than that.
const POOL = 20_000;

type Candidate = Article & { embedding: Buffer; feed_title: string };

function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) sum += a[i] * b[i];
  return sum;
}

// Articles related to this one, best first. Empty when the article has no
// embedding yet, or when nothing clears the floor — both are ordinary, and the
// caller falls back to the list it came from.
export function relatedArticles(
  articleId: number,
  userId: number,
  limit: number
): Article[] {
  const db = getDb();
  const seed = db
    .prepare("SELECT embedding, feed_id FROM articles WHERE id = ?")
    .get(articleId) as { embedding: Buffer | null; feed_id: number } | undefined;
  if (!seed?.embedding) return [];
  const seedVector = bufferToVector(seed.embedding);

  // Anything the reader has already dealt with is not a next read. Saved is in
  // there too: it is already on a list of its own.
  const rows = db
    .prepare(
      `SELECT ${ARTICLE_COLUMNS}, a.embedding, f.title AS feed_title
       FROM articles a
       JOIN feeds f ON f.id = a.feed_id
       WHERE f.enabled = 1 AND f.subscribed = 1
         AND a.embedding IS NOT NULL
         AND a.id != ?
         AND a.published_at > datetime('now', ?)
         AND NOT EXISTS (
           SELECT 1 FROM user_events e
           WHERE e.user_id = ? AND e.link = a.link
             AND e.action IN ('open', 'dwell', 'save', 'skip', 'dislike')
         )
       ORDER BY a.published_at DESC
       LIMIT ?`
    )
    .all(articleId, `-${WINDOW_DAYS} days`, userId, POOL) as Candidate[];
  if (rows.length === 0) return [];

  const { vector: profile } = buildProfile(userId);

  const scored: Array<{ article: Candidate; score: number }> = [];
  for (const article of rows) {
    const vector = bufferToVector(article.embedding);
    const similarity = cosine(seedVector, vector);
    if (similarity < FLOOR || similarity >= CEILING) continue;
    let score = similarity;
    if (profile) {
      score += TASTE_WEIGHT * (cosine(profile, vector) - RANDOM_PAIR_MEDIAN);
    }
    if (isCommerceRoundup(article.title)) score -= COMMERCE_PENALTY;
    scored.push({ article, score });
  }
  if (scored.length === 0) return [];

  // Greedy pick with a per-feed penalty, the same shape as `diversify` in
  // recommend.ts — two cards from one publication is a rail that has stopped
  // being about the article and started being about The Verge.
  scored.sort((a, b) => b.score - a.score);
  const picked: Article[] = [];
  const perFeed = new Map<number, number>();
  while (picked.length < limit && scored.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < scored.length; i++) {
      const taken = perFeed.get(scored[i].article.feed_id) ?? 0;
      const value = scored[i].score - taken * FEED_REPEAT_PENALTY;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const [chosen] = scored.splice(bestIndex, 1);
    perFeed.set(
      chosen.article.feed_id,
      (perFeed.get(chosen.article.feed_id) ?? 0) + 1
    );
    const { embedding, ...article } = chosen.article;
    void embedding;
    picked.push(article as Article);
  }
  return picked;
}
