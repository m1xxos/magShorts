import { getDb, type Article } from "./db";
import { bufferToVector, EMBEDDING_DIM } from "./embeddings";
import { buildProfile, isCommerceRoundup } from "./recommend";
import type { CatalogArticleDto, CatalogPublicationDto } from "./types";
import { readingMinutesFromHtml } from "./readingTime";

// The Discover catalog: publications the user has not subscribed to
// (feeds.subscribed = 0), ranked against the same taste profile the For you
// grid and the digest use, so "ranked by what you read and save" is literally
// true rather than a slogan.

const ARTICLES_PER_PUBLICATION = 3;
// Without a taste profile the score is pure recency, and a publication that
// posts hourly would sweep the page; the per-publication cap in the query
// keeps that honest.
const RECENCY_WINDOW_MS = 30 * 24 * 3_600_000;
// About one a day: anything up to this is a publication with a rhythm, above
// it is a wire.
const VOLUME_FREE_PER_WEEK = 7;
// Enough to lose to any real article without hiding the publication.
const COMMERCE_PENALTY = 0.06;
// An article with no picture is a grey gradient in the grid and a blank tile
// in a publication block, and three blank tiles say nothing about a
// publication you have never met. Worth about as much as being a coupon
// roundup — enough to lose a slot to an illustrated rival of similar fit, not
// enough to bury a publication that fits far better without pictures.
const IMAGE_PENALTY = 0.06;

// Feed categories that say nothing about an article. These make useless chips
// and would otherwise dominate them, since a big feed tags everything alike.
export const GENERIC_TOPICS = new Set([
  "uncategorized",
  "articles",
  "article",
  "blog",
  "news",
  "breaking news",
  "latest",
  "featured",
  "editor's pick",
  "editors pick",
  "general",
  "posts",
  "misc",
  "other",
]);

export interface CatalogFilter {
  topic?: string;
  query?: string;
  // One publication only — what "more from this publication" asks for.
  feedId?: number;
  limit: number;
  offset: number;
}

type CatalogRow = Article & {
  feed_title: string;
  site_url: string | null;
  description: string | null;
  subscribed: number;
  embedding: Buffer | null;
};

function fetchCatalogArticles(filter: CatalogFilter): CatalogRow[] {
  const where: string[] = ["f.subscribed = 0", "f.enabled = 1"];
  const params: unknown[] = [];
  if (filter.feedId !== undefined) {
    where.push("f.id = ?");
    params.push(filter.feedId);
  }
  if (filter.topic) {
    where.push("a.topic = ?");
    params.push(filter.topic);
  }
  if (filter.query) {
    // One field searches publications and articles alike, per the design.
    where.push(
      "(a.title LIKE ? OR f.title LIKE ? OR IFNULL(f.description,'') LIKE ?)"
    );
    const like = `%${filter.query}%`;
    params.push(like, like, like);
  }
  return getDb()
    .prepare(
      `SELECT a.*, f.title AS feed_title, f.site_url, f.description, f.subscribed
       FROM articles a JOIN feeds f ON f.id = a.feed_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.published_at DESC`
    )
    .all(...params) as CatalogRow[];
}

function scoreOf(
  article: CatalogRow,
  profile: Float32Array | null,
  now: number
): number {
  const publishedMs = article.published_at
    ? new Date(article.published_at).getTime()
    : now - RECENCY_WINDOW_MS;
  const recency = Math.max(0, 1 - (now - publishedMs) / RECENCY_WINDOW_MS);
  // Same demotion the digest applies, and it matters more here: these three
  // tiles are the case a publication makes for itself, and a coupon roundup
  // makes the wrong one.
  const commerce = isCommerceRoundup(article.title) ? COMMERCE_PENALTY : 0;
  const blank = article.image_url ? 0 : IMAGE_PENALTY;
  if (!profile || !article.embedding) return recency - commerce - blank;
  const embedding = bufferToVector(article.embedding);
  let cosine = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) cosine += profile[i] * embedding[i];
  // Recency barely counts here. The catalog answers "what is this publication
  // like", and a firehose posting a thousand times a week would otherwise win
  // every slot on the strength of having published something four minutes ago.
  return cosine + recency * 0.03 - commerce - blank;
}

function toArticleDto(
  article: CatalogRow,
  score: number
): CatalogArticleDto {
  return {
    id: article.id,
    feed_id: article.feed_id,
    title: article.title,
    link: article.link,
    summary: article.summary,
    image_url: article.image_url,
    published_at: article.published_at,
    topic: article.topic,
    feed_title: article.feed_title,
    site_url: article.site_url,
    is_subscribed: article.subscribed === 1,
    score,
    reading_minutes: readingMinutesFromHtml(article.content),
  };
}

// The article-by-article view: the catalog flattened, publication demoted to a
// footer. One article per publication near the top so the first screen isn't
// three pieces from whoever posts most.
export function catalogArticles(
  userId: number,
  filter: CatalogFilter
): { articles: CatalogArticleDto[]; total: number } {
  const { vector: profile } = buildProfile(userId);
  const now = Date.now();
  const scored = fetchCatalogArticles(filter)
    .map((article) => ({ article, score: scoreOf(article, profile, now) }))
    .sort((a, b) => b.score - a.score);

  const seen = new Map<number, number>();
  const first: typeof scored = [];
  const rest: typeof scored = [];
  for (const entry of scored) {
    const count = seen.get(entry.article.feed_id) ?? 0;
    seen.set(entry.article.feed_id, count + 1);
    (count === 0 ? first : rest).push(entry);
  }

  const ordered = [...first, ...rest];
  return {
    total: ordered.length,
    articles: ordered
      .slice(filter.offset, filter.offset + filter.limit)
      .map((entry) => toArticleDto(entry.article, entry.score)),
  };
}

// How often a publication posts, from what we actually hold. Computed rather
// than stored — a stored cadence goes stale silently.
//
// Returned unrounded, and it can be well below 1: a catalog publication keeps
// only its ten newest articles, so a monthly blog measures ~0.23/week. Rounding
// that up to "1 post / week" would be a lie, so the phrasing (per week or per
// month) is left to the caller.
function postsPerWeek(articles: CatalogRow[]): number | null {
  const dates = articles
    .map((article) =>
      article.published_at ? new Date(article.published_at).getTime() : null
    )
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (dates.length < 2) return null;
  const weeks = (dates[dates.length - 1] - dates[0]) / (7 * 24 * 3_600_000);
  if (weeks <= 0) return null;
  return Math.round(((dates.length - 1) / weeks) * 100) / 100;
}

// The publications view: one block per publication, carrying the three
// articles that make the case for it.
export function catalogPublications(
  userId: number,
  filter: CatalogFilter
): { publications: CatalogPublicationDto[]; total: number } {
  const { vector: profile } = buildProfile(userId);
  const now = Date.now();
  const byFeed = new Map<number, Array<{ article: CatalogRow; score: number }>>();
  for (const article of fetchCatalogArticles(filter)) {
    const bucket = byFeed.get(article.feed_id) ?? [];
    bucket.push({ article, score: scoreOf(article, profile, now) });
    byFeed.set(article.feed_id, bucket);
  }

  const publications = [...byFeed.values()]
    .map((entries) => {
      const ranked = [...entries].sort((a, b) => b.score - a.score);
      const head = ranked[0].article;
      // Judged on its best three together rather than its single best: one
      // lucky match is what a high-volume feed produces by accident, while a
      // publication that genuinely fits matches again and again. The image
      // penalty rides along in each article's score, so a publication that
      // never illustrates anything sinks on its own — and the three tiles it
      // does show are its illustrated ones.
      const shown = ranked.slice(0, ARTICLES_PER_PUBLICATION);
      const fit =
        shown.reduce((sum, entry) => sum + entry.score, 0) / shown.length;
      // A wire posting a thousand times a week always has something from four
      // minutes ago, and on a page of 87 publications that alone would win.
      // Only volume above a comfortable daily rate is damped: penalising every
      // publication by its output would instead float blogs that have been
      // dormant for years, which is the opposite of useful.
      const rate = postsPerWeek(entries.map((entry) => entry.article));
      const volumePenalty =
        rate && rate > VOLUME_FREE_PER_WEEK
          ? Math.min(0.25, Math.log10(rate / VOLUME_FREE_PER_WEEK) * 0.15)
          : 0;
      const topics = [
        ...new Set(
          entries
            .map((entry) => entry.article.topic)
            .filter((topic): topic is string => Boolean(topic))
        ),
      ];
      return {
        score: fit - volumePenalty,
        publication: {
          id: head.feed_id,
          title: head.feed_title,
          site_url: head.site_url,
          description: head.description,
          posts_per_week: rate,
          topics,
          is_subscribed: head.subscribed === 1,
          articles: shown.map((entry) =>
            toArticleDto(entry.article, entry.score)
          ),
          article_count: entries.length,
        } satisfies CatalogPublicationDto,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    total: publications.length,
    publications: publications
      .slice(filter.offset, filter.offset + filter.limit)
      .map((entry) => entry.publication),
  };
}

// Chip counts, over the whole catalog rather than the current page — a chip
// that says 6 should still say 6 after you scroll.
// A label carried by this many different publications is filing, not a
// subject. Measured over the whole corpus: the folder names reach 26 and 7
// publications, while the widest genuine category a feed ever declares — "AI"
// — reaches 8. Ten leaves room for a real category to spread and still
// catches a folder label whose folder is gone.
const TOPIC_MAX_PUBLICATIONS = 10;

export function catalogTopics(): Array<{ topic: string; count: number }> {
  return getDb()
    .prepare(
      // Ingest falls back to the feed's folder name when an article publishes
      // no usable category. That is the user's filing, not the article's
      // subject, and it makes a useless chip — a folder of 47 blogs would show
      // up as one topic covering everything.
      //
      // Matching the current folder names is not enough on its own: the label
      // was written into the article when it was fetched and outlives the
      // folder, so deleting a folder used to promote its name straight into
      // the chips. A folder called Discover, emptied into the catalog and then
      // removed, came back as a chip reading "Discover 1392".
      `SELECT a.topic AS topic, COUNT(*) AS count
       FROM articles a JOIN feeds f ON f.id = a.feed_id
       WHERE f.subscribed = 0 AND f.enabled = 1 AND a.topic IS NOT NULL
         AND a.topic NOT IN (SELECT name FROM folders)
       GROUP BY a.topic
       HAVING count >= 2 AND COUNT(DISTINCT a.feed_id) < ${TOPIC_MAX_PUBLICATIONS}
       ORDER BY count DESC, topic ASC LIMIT 24`
    )
    .all()
    .filter((row) => {
      const topic = (row as { topic: string }).topic;
      // Some feeds number their categories. "1" is not a subject.
      return !GENERIC_TOPICS.has(topic.toLowerCase()) && !/^\d+$/.test(topic);
    })
    .slice(0, 10) as Array<{ topic: string; count: number }>;
}

export function catalogSize(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM feeds WHERE subscribed = 0 AND enabled = 1")
    .get() as { n: number };
  return row.n;
}
