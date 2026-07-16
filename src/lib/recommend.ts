import { getDb, type Article } from "./db";
import { EMBEDDING_DIM, bufferToVector } from "./embeddings";

export type RecWindow = "day" | "week" | "month";

export const REC_WINDOWS: RecWindow[] = ["day", "week", "month"];

const WINDOW_HOURS: Record<RecWindow, number> = {
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
};

// How strongly each action shapes the taste profile.
const ACTION_WEIGHTS: Record<string, number> = {
  like: 1.5,
  save: 1.0,
  open: 0.4,
  dwell: 0.3,
  skip: -0.2,
  dislike: -1.2,
};

const DECAY_DAYS = 30;
const COLD_START_MIN_POSITIVE = 5;
const FEED_REPEAT_PENALTY = 0.03;
const RECENCY_BONUS = 0.1;
const EXPLORATION_EVERY = 10;

interface ProfileResult {
  vector: Float32Array | null;
  positiveSignals: number;
}

function buildProfile(userId: number): ProfileResult {
  const db = getDb();
  // Latest event per link wins; fall back to the article's embedding for
  // events recorded before the article was embedded.
  const rows = db
    .prepare(
      `SELECT e.action, e.created_at,
              COALESCE(e.embedding, a.embedding) AS embedding
       FROM user_events e
       LEFT JOIN articles a ON a.link = e.link
       WHERE e.user_id = ?
         AND e.id = (
           SELECT MAX(e2.id) FROM user_events e2
           WHERE e2.user_id = e.user_id AND e2.link = e.link
         )`
    )
    .all(userId) as Array<{
    action: string;
    created_at: string;
    embedding: Buffer | null;
  }>;

  const vector = new Float32Array(EMBEDDING_DIM);
  let positiveSignals = 0;
  let contributions = 0;
  const now = Date.now();

  for (const row of rows) {
    const weight = ACTION_WEIGHTS[row.action];
    if (!weight || !row.embedding) continue;
    const ageDays = Math.max(
      0,
      (now - new Date(row.created_at.replace(" ", "T") + "Z").getTime()) /
        86_400_000
    );
    const decay = Math.exp(-ageDays / DECAY_DAYS);
    const embedding = bufferToVector(row.embedding);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vector[i] += weight * decay * embedding[i];
    }
    contributions++;
    if (weight > 0) positiveSignals++;
  }

  if (contributions === 0 || positiveSignals < COLD_START_MIN_POSITIVE) {
    return { vector: null, positiveSignals };
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return { vector: null, positiveSignals };
  for (let i = 0; i < EMBEDDING_DIM; i++) vector[i] /= norm;
  return { vector, positiveSignals };
}

// Deterministic PRNG so exploration slots stay stable within a day
// (keeps infinite-scroll pagination consistent between requests).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Candidate = Article & { embedding: Buffer };

interface Scored {
  article: Candidate;
  score: number;
}

export interface Recommendations {
  articles: Article[];
  coldStart: boolean;
}

interface CandidateFilter {
  excludeViews: boolean;
  // Restrict to one folder (explicit selection ignores the folder's
  // include_in_main toggle).
  folderId?: number;
  // Hide folders toggled out of the main feed (For you honors this;
  // the default all-folders Shorts doesn't).
  respectIncludeInMain?: boolean;
}

function fetchCandidates(
  userId: number,
  hours: number,
  filter: CandidateFilter
): Candidate[] {
  // For you keeps articles the user merely saw in Shorts (view); Shorts
  // itself excludes everything ever shown or touched.
  const exclusion = filter.excludeViews
    ? "SELECT link FROM user_events WHERE user_id = ?"
    : "SELECT link FROM user_events WHERE user_id = ? AND action != 'view'";
  const params: unknown[] = [`-${hours} hours`, userId];
  let folderClause = "";
  if (filter.folderId !== undefined) {
    folderClause = "AND f.folder_id = ?";
    params.push(filter.folderId);
  } else if (filter.respectIncludeInMain) {
    folderClause = "AND (f.folder_id IS NULL OR fo.include_in_main = 1)";
  }
  return getDb()
    .prepare(
      `SELECT a.*, f.title AS feed_title FROM articles a
       JOIN feeds f ON f.id = a.feed_id
       LEFT JOIN folders fo ON fo.id = f.folder_id
       WHERE f.enabled = 1
         AND a.embedding IS NOT NULL
         AND a.published_at >= datetime('now', ?)
         AND a.link NOT IN (${exclusion})
         ${folderClause}
       ORDER BY a.published_at DESC`
    )
    .all(...params) as Candidate[];
}

function scoreCandidates(
  candidates: Candidate[],
  profile: Float32Array | null,
  windowMs: number
): Scored[] {
  const now = Date.now();
  return candidates.map((article) => {
    const publishedMs = article.published_at
      ? new Date(article.published_at).getTime()
      : now - windowMs;
    const recency = Math.max(0, 1 - (now - publishedMs) / windowMs);
    let score = recency * RECENCY_BONUS;
    if (profile) {
      const embedding = bufferToVector(article.embedding);
      let cosine = 0;
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        cosine += profile[i] * embedding[i];
      }
      score += cosine;
    }
    return { article, score };
  });
}

// Greedy pick with a per-feed penalty so one publication can't flood the
// feed even when it dominates the taste profile.
function diversify(scored: Scored[]): Candidate[] {
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const pickedPerFeed = new Map<number, number>();
  const ranked: Candidate[] = [];
  while (pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const picked = pickedPerFeed.get(pool[i].article.feed_id) ?? 0;
      const value = pool[i].score - picked * FEED_REPEAT_PENALTY;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    ranked.push(chosen.article);
    pickedPerFeed.set(
      chosen.article.feed_id,
      (pickedPerFeed.get(chosen.article.feed_id) ?? 0) + 1
    );
  }
  return ranked;
}

function stripEmbedding(candidate: Candidate): Article {
  const article = { ...candidate } as Partial<Candidate>;
  delete article.embedding;
  return article as Article;
}

export function recommendArticles(
  userId: number,
  window: RecWindow,
  limit: number,
  offset: number
): Recommendations {
  const hours = WINDOW_HOURS[window];
  const candidates = fetchCandidates(userId, hours, {
    excludeViews: false,
    respectIncludeInMain: true,
  });
  const { vector: profile } = buildProfile(userId);
  const scored = scoreCandidates(candidates, profile, hours * 3_600_000);
  const ranked = diversify(scored);

  // Exploration: with a taste profile, every Nth slot surfaces a random
  // article from deeper in the ranking to avoid a filter bubble.
  if (profile && ranked.length > EXPLORATION_EVERY * 2) {
    const day = new Date().toISOString().slice(0, 10);
    const random = mulberry32(
      userId * 31 + [...day].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
    );
    for (
      let slot = EXPLORATION_EVERY - 1;
      slot < ranked.length / 2;
      slot += EXPLORATION_EVERY
    ) {
      const tailIndex =
        Math.floor(ranked.length / 2 + random() * (ranked.length / 2)) %
        ranked.length;
      [ranked[slot], ranked[tailIndex]] = [ranked[tailIndex], ranked[slot]];
    }
  }

  const page = ranked.slice(offset, offset + limit).map(stripEmbedding);
  return { articles: page, coldStart: !profile };
}

const SHORTS_MONTH_INSERT_EVERY = 5;

// Shorts ordering: today's most interesting first, then the week's picks
// with an older (7–30d) insert every few slots, then the remaining tail —
// the transition happens seamlessly as the user scrolls.
export function recommendShorts(
  userId: number,
  limit: number,
  folderId?: number
): Recommendations {
  // Default Shorts spans every enabled feed regardless of folder toggles;
  // a folder pill narrows it to that folder only.
  const candidates = fetchCandidates(userId, 24 * 30, {
    excludeViews: true,
    folderId,
  });
  const { vector: profile } = buildProfile(userId);
  const monthMs = 30 * 24 * 3_600_000;
  const scored = scoreCandidates(candidates, profile, monthMs);

  const now = Date.now();
  const dayTier: Scored[] = [];
  const weekTier: Scored[] = [];
  const monthTier: Scored[] = [];
  for (const entry of scored) {
    const publishedMs = entry.article.published_at
      ? new Date(entry.article.published_at).getTime()
      : 0;
    const ageMs = now - publishedMs;
    if (ageMs < 24 * 3_600_000) dayTier.push(entry);
    else if (ageMs < 7 * 24 * 3_600_000) weekTier.push(entry);
    else monthTier.push(entry);
  }

  const result: Candidate[] = diversify(dayTier);
  const week = diversify(weekTier);
  const month = diversify(monthTier);
  let slot = 0;
  while (week.length > 0) {
    slot++;
    if (slot % SHORTS_MONTH_INSERT_EVERY === 0 && month.length > 0) {
      result.push(month.shift()!);
    } else {
      result.push(week.shift()!);
    }
  }
  result.push(...month);

  return {
    articles: result.slice(0, limit).map(stripEmbedding),
    coldStart: !profile,
  };
}
