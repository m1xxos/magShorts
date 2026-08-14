import { getDb, type Article } from "./db";
import { bufferToVector, EMBEDDING_DIM } from "./embeddings";
import { rankForDigest, type DigestCandidate } from "./recommend";
import { fetchPageHtml } from "./articleImages";
import { decodeEntities } from "./rss";
import { complete, llmConfigured } from "./llm";
import { getCountSetting, getSetting } from "./settings";
import {
  type DigestDto,
  type DigestItemDto,
  type DigestKind,
  type DigestSection,
} from "./types";

const WINDOW_HOURS: Record<DigestKind, number> = { daily: 24, weekly: 24 * 7 };

// One lead, the runners-up, the quick hits, and everything left over behind
// "Show all N". Every lead and also card costs one LLM call, so `also` sets
// the per-digest call count: 1 + also + 1 for the summary panel. Capped
// because that cost is paid sequentially on whatever box runs the model.
const LEAD_COUNT = 1;
const ALSO_MAX = 12;
const QUICK_MAX = 20;

export function digestSizes(): { also: number; quick: number } {
  return {
    also: getCountSetting("digest_also_count", 0, ALSO_MAX),
    quick: getCountSetting("digest_quick_count", 0, QUICK_MAX),
  };
}

// Cosine above which two articles are the same story and only the
// better-ranked one reaches the page.
// e5 packs everything into a narrow band: measured over 376 real articles the
// median pair scores .75 and the 99th percentile .844, while the same story
// from two publications lands at .87–.93. Compared against the cluster's lead
// only, so near-misses can't chain a cluster open.
const CLUSTER_THRESHOLD = 0.87;

const TEXT_MAX_LENGTH = 6000;
// Below this a "body" is unusable as an article text.
const TEXT_MIN_LENGTH = 400;
// Plenty of feeds (Habr, The Verge) ship a ~1 KB teaser in content:encoded and
// call it the body — long enough to summarise badly, short enough that the page
// is worth fetching. Only a body above this skips the fetch.
const TEXT_TRUSTED_LENGTH = 1500;
const WORDS_PER_MINUTE = 200;

// ---------------------------------------------------------------- scheduling

interface ZonedNow {
  date: string; // YYYY-MM-DD in the digest timezone
  minutes: number; // minutes since local midnight
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function digestTimeZone(): string {
  return getSetting("digest_tz") || "UTC";
}

export function digestSchedule(): { daily: string; weekly: string; timeZone: string } {
  return {
    daily: getSetting("digest_daily_at"),
    weekly: getSetting("digest_weekly_at"),
    timeZone: digestTimeZone(),
  };
}

function zonedNow(now: Date, timeZone: string): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  // "24" shows up at midnight in some ICU versions.
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday").toLowerCase().slice(0, 3))),
  };
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  // Noon UTC keeps the arithmetic clear of every DST edge.
  const shifted = new Date(Date.UTC(year, month - 1, day, 12) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function parseTime(value: string | undefined, fallback: number): number {
  const match = value?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

// The period a digest belongs to, labelled by the date of the most recent
// scheduled build time at or before `now`. A host that slept through 08:00
// therefore still recognises today's digest as due when it wakes at 11:00,
// and one that already exists is never rebuilt.
export function duePeriodKey(kind: DigestKind, now = new Date()): string {
  const local = zonedNow(now, digestTimeZone());
  if (kind === "daily") {
    const at = parseTime(getSetting("digest_daily_at"), 8 * 60);
    return local.minutes >= at ? local.date : shiftDate(local.date, -1);
  }
  const spec = getSetting("digest_weekly_at") || "Sun 19:00";
  const at = parseTime(spec, 19 * 60);
  const wanted = WEEKDAYS.indexOf(spec.toLowerCase().slice(0, 3));
  const target = wanted >= 0 ? wanted : 0;
  let daysBack = (local.weekday - target + 7) % 7;
  if (daysBack === 0 && local.minutes < at) daysBack = 7;
  return `w${shiftDate(local.date, -daysBack)}`;
}

// ------------------------------------------------------------- article text

function htmlToText(html: string): string {
  // Prefer the article body when the page marks one; otherwise take the whole
  // document minus the furniture.
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  let body = article?.[1] ?? html;
  body = body.replace(
    /<(script|style|noscript|svg|head|nav|header|footer|aside|form|figure)\b[\s\S]*?<\/\1>/gi,
    " "
  );
  return decodeEntities(body.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

type TextSource = Pick<Article, "id" | "link" | "title" | "summary" | "content">;

// What the model (and the bench) actually sees: the stored feed body when the
// feed ships a real one, otherwise the article page. Scraped text is never
// written back — articles.content stays what the feed published, and a page
// fetch costs four requests a day.
export async function articleFullText(article: TextSource): Promise<string> {
  const stored = article.content?.trim() ?? "";
  if (stored.length >= TEXT_TRUSTED_LENGTH) return stored.slice(0, TEXT_MAX_LENGTH);

  const page = await fetchPageHtml(article.link);
  const fetched = page ? htmlToText(page.html).slice(0, TEXT_MAX_LENGTH) : "";
  if (fetched.length >= TEXT_MIN_LENGTH && fetched.length > stored.length) {
    return fetched;
  }
  return stored || article.summary?.trim() || article.title;
}

// The extractive fallback reads from the feed instead, even when the page gave
// us more: a scraped page opens with bylines, timestamps and cookie notices,
// and those would be the first sentences on the card.
function teaserSource(article: TextSource): string {
  const stored = article.content?.trim() ?? "";
  if (stored.length >= TEXT_MIN_LENGTH) return stored;
  return article.summary?.trim() || stored || article.title;
}

function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

function firstSentences(text: string, count: number): string {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length === 0) return text.slice(0, 300);
  return sentences.slice(0, count).join(" ").slice(0, 600);
}

// ---------------------------------------------------------------- selection

interface Cluster {
  lead: DigestCandidate;
  vector: Float32Array;
  size: number;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) sum += a[i] * b[i];
  return sum;
}

// Same story from several publications collapses into one cluster; the
// best-ranked member represents it and the cluster's size feeds the summary.
function clusterStories(ranked: DigestCandidate[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const article of ranked) {
    const vector = bufferToVector(article.embedding);
    const existing = clusters.find(
      (cluster) => cosine(vector, cluster.vector) >= CLUSTER_THRESHOLD
    );
    if (existing) existing.size++;
    else clusters.push({ lead: article, vector, size: 1 });
  }
  return clusters;
}

// ------------------------------------------------------------------ prompts

const NO_INVENTION =
  "Use only what the supplied text says — never add a fact, number, name or " +
  "conclusion that is not in it. Write in the same language as the article. " +
  "Plain prose only: no markdown, no bullet points, no headings, and no " +
  "quotation marks around your answer. Do not begin with the publication name " +
  "or repeat the headline.";

export const LEAD_SYSTEM = `You write the lead blurb of a personal news digest. Write three or four sentences telling the reader what the article says and why it matters. ${NO_INVENTION}`;

const CARD_SYSTEM = `You write the short blurbs of a personal news digest. Write one or two sentences telling the reader what the article says. ${NO_INVENTION}`;

const THREE_LINES_SYSTEM =
  "You write the 'In three lines' panel of a personal news digest: three " +
  "observations about the day's news taken as a whole — what several " +
  "publications converged on, what is missing, what is unusually quiet. They " +
  "are observations, not headlines, and not a list of the articles. Answer " +
  "with exactly three lines, one sentence each, separated by newlines. Write " +
  "in English. No markdown, no numbering, no preamble.";

interface Annotated {
  article: DigestCandidate;
  summary: string;
  minutes: number;
  // The provider that actually answered, so the snapshot can record whether
  // it holds real annotations or the extractive stand-in.
  wrote: { provider: string; model: string } | null;
}

async function annotate(
  article: DigestCandidate,
  sentences: number,
  system: string
): Promise<Annotated> {
  const text = await articleFullText(article);
  const minutes = readingMinutes(text);
  const extractive = firstSentences(teaserSource(article), sentences);
  if (!llmConfigured()) {
    return { article, summary: extractive, minutes, wrote: null };
  }
  const result = await complete(
    system,
    `Publication: ${article.feed_title ?? ""}\nHeadline: ${article.title}\n\n${text}`,
    sentences <= 2 ? 160 : 320
  );
  return {
    article,
    summary: result?.text ?? extractive,
    minutes,
    wrote: result ? { provider: result.provider, model: result.model } : null,
  };
}

// Honest, template-built stand-in for the LLM's three lines: counts and the
// clustering we already computed, with nothing invented.
function templateThreeLines(
  clusters: Cluster[],
  articleCount: number,
  publicationCount: number,
  kind: DigestKind
): string[] {
  const period = kind === "daily" ? "since yesterday" : "over the past week";
  const biggest = clusters.reduce(
    (best, cluster) => (cluster.size > best.size ? cluster : best),
    clusters[0]
  );
  const perFeed = new Map<string, number>();
  for (const cluster of clusters) {
    const feed = cluster.lead.feed_title ?? "Unknown";
    perFeed.set(feed, (perFeed.get(feed) ?? 0) + 1);
  }
  const busiest = [...perFeed.entries()].sort((a, b) => b[1] - a[1])[0];

  return [
    `${articleCount} articles from ${publicationCount} publication${
      publicationCount === 1 ? "" : "s"
    } ${period}.`,
    biggest && biggest.size > 1
      ? `The biggest thread is "${biggest.lead.title}" — ${biggest.size} pieces on it.`
      : "No story was picked up by more than one publication.",
    busiest ? `${busiest[0]} filed the most (${busiest[1]}).` : "A quiet stretch.",
  ];
}

async function buildThreeLines(
  clusters: Cluster[],
  articleCount: number,
  publicationCount: number,
  kind: DigestKind
): Promise<{ lines: string[]; wrote: { provider: string; model: string } | null }> {
  const fallback = templateThreeLines(
    clusters,
    articleCount,
    publicationCount,
    kind
  );
  if (!llmConfigured()) return { lines: fallback, wrote: null };

  // Headlines and cluster sizes only. Sending the bodies would multiply the
  // prefill of the whole digest for one paragraph of output.
  const lines = clusters
    .slice(0, 30)
    .map(
      (cluster) =>
        `- ${cluster.lead.title} (${cluster.lead.feed_title ?? "?"}${
          cluster.size > 1 ? `, +${cluster.size - 1} similar` : ""
        })`
    )
    .join("\n");
  const result = await complete(
    THREE_LINES_SYSTEM,
    `${articleCount} articles from ${publicationCount} publications.\n\n${lines}`,
    260
  );
  if (!result) return { lines: fallback, wrote: null };

  const parsed = result.text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
  return {
    lines: parsed.length >= 3 ? parsed.slice(0, 3) : fallback,
    wrote: { provider: result.provider, model: result.model },
  };
}

// ------------------------------------------------------------------- build

export function hasDigest(
  userId: number,
  kind: DigestKind,
  periodKey: string
): boolean {
  return Boolean(
    getDb()
      .prepare(
        "SELECT 1 FROM digests WHERE user_id = ? AND kind = ? AND period_key = ?"
      )
      .get(userId, kind, periodKey)
  );
}

export interface BuildResult {
  digestId: number;
  created: boolean;
  llmCalls: number;
}

// One build at a time, process-wide. The scheduler and the manual endpoint can
// both ask for one, and two concurrent builds would race on the same period
// row and double the LLM load on a box that has none to spare.
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

// Builds (or returns) one user's snapshot for a period. Never runs inside a
// request path — the scheduler and the manual build endpoint are the only
// callers, and the endpoint answers before the work finishes.
export function buildDigest(
  userId: number,
  kind: DigestKind,
  options: { periodKey?: string; force?: boolean } = {}
): Promise<BuildResult | null> {
  return exclusive(() => doBuildDigest(userId, kind, options));
}

async function doBuildDigest(
  userId: number,
  kind: DigestKind,
  options: { periodKey?: string; force?: boolean }
): Promise<BuildResult | null> {
  const db = getDb();
  const periodKey = options.periodKey ?? duePeriodKey(kind);

  const existing = db
    .prepare(
      "SELECT id FROM digests WHERE user_id = ? AND kind = ? AND period_key = ?"
    )
    .get(userId, kind, periodKey) as { id: number } | undefined;
  if (existing && !options.force) {
    return { digestId: existing.id, created: false, llmCalls: 0 };
  }

  const hours = WINDOW_HOURS[kind];
  const ranked = rankForDigest(userId, hours);
  if (ranked.length === 0) return null;

  const clusters = clusterStories(ranked);
  const publications = new Set(ranked.map((article) => article.feed_id)).size;

  const { also: alsoCount, quick: quickCount } = digestSizes();
  const lead = clusters.slice(0, LEAD_COUNT);
  const also = clusters.slice(LEAD_COUNT, LEAD_COUNT + alsoCount);
  const quick = clusters.slice(
    LEAD_COUNT + alsoCount,
    LEAD_COUNT + alsoCount + quickCount
  );
  const rest = clusters.slice(LEAD_COUNT + alsoCount + quickCount);

  // One call per annotated card, plus one for the summary panel.
  const annotated: Array<{ section: DigestSection; entry: Annotated }> = [];
  for (const cluster of lead) {
    annotated.push({
      section: "lead",
      entry: await annotate(cluster.lead, 4, LEAD_SYSTEM),
    });
  }
  for (const cluster of also) {
    annotated.push({
      section: "also",
      entry: await annotate(cluster.lead, 2, CARD_SYSTEM),
    });
  }
  const threeLines = await buildThreeLines(
    clusters,
    ranked.length,
    publications,
    kind
  );

  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - hours * 3_600_000).toISOString();
  // Whatever actually answered — NULL here means the whole digest is
  // extractive, which the page says out loud.
  const wrote =
    annotated.find(({ entry }) => entry.wrote)?.entry.wrote ??
    threeLines.wrote ??
    null;
  const llmCalls =
    annotated.filter(({ entry }) => entry.wrote).length +
    (threeLines.wrote ? 1 : 0);

  const write = db.transaction(() => {
    if (existing) db.prepare("DELETE FROM digests WHERE id = ?").run(existing.id);
    const inserted = db
      .prepare(
        `INSERT INTO digests
           (user_id, kind, period_key, period_start, period_end, three_lines,
            total_articles, total_publications, llm_provider, llm_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        kind,
        periodKey,
        periodStart,
        periodEnd,
        JSON.stringify(threeLines.lines),
        ranked.length,
        publications,
        wrote?.provider ?? null,
        wrote?.model ?? null
      );
    const digestId = Number(inserted.lastInsertRowid);
    const addItem = db.prepare(
      `INSERT INTO digest_items
         (digest_id, article_id, section, position, summary, reading_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    let position = 0;
    for (const { section, entry } of annotated) {
      addItem.run(
        digestId,
        entry.article.id,
        section,
        position++,
        entry.summary,
        entry.minutes
      );
    }
    // Quick hits and the tail are headline-only, so they cost nothing to
    // store and keep "Show all N" part of the frozen snapshot.
    for (const [index, cluster] of quick.entries()) {
      addItem.run(digestId, cluster.lead.id, "quick", index, null, null);
    }
    for (const [index, cluster] of rest.entries()) {
      addItem.run(digestId, cluster.lead.id, "rest", index, null, null);
    }
    return digestId;
  });

  const digestId = write();
  console.log(
    `[digest] built ${kind} ${periodKey} for user ${userId}: ` +
      `${clusters.length} stories from ${ranked.length} articles`
  );
  return { digestId, created: true, llmCalls };
}

// -------------------------------------------------------------------- read

interface DigestRow {
  id: number;
  kind: string;
  period_key: string;
  period_start: string;
  period_end: string;
  built_at: string;
  three_lines: string;
  total_articles: number;
  total_publications: number;
  llm_provider: string | null;
  llm_model: string | null;
}

// A read of the stored snapshot — nothing is recomputed. Items the user has
// skipped since it was built drop out, which is what makes Skip stick.
export function readDigest(
  userId: number,
  kind: DigestKind
): DigestDto | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM digests WHERE user_id = ? AND kind = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, kind) as DigestRow | undefined;
  if (!row) return null;

  const items = db
    .prepare(
      `SELECT d.article_id, d.section, d.position, d.summary, d.reading_minutes,
              a.title, a.link, a.image_url, a.published_at, a.topic,
              a.feed_id, f.title AS feed_title, f.site_url
       FROM digest_items d
       JOIN articles a ON a.id = d.article_id
       JOIN feeds f ON f.id = a.feed_id
       WHERE d.digest_id = ?
         AND a.link NOT IN (
           SELECT link FROM user_events WHERE user_id = ? AND action = 'skip'
         )
       ORDER BY d.section, d.position`
    )
    .all(row.id, userId) as DigestItemDto[];

  let threeLines: string[] = [];
  try {
    const parsed = JSON.parse(row.three_lines);
    if (Array.isArray(parsed)) threeLines = parsed.map(String);
  } catch {
    // A malformed snapshot should not take the page down.
  }

  return {
    kind: row.kind as DigestKind,
    period_key: row.period_key,
    period_start: row.period_start,
    period_end: row.period_end,
    built_at: row.built_at,
    three_lines: threeLines,
    total_articles: row.total_articles,
    total_publications: row.total_publications,
    llm_provider: row.llm_provider,
    llm_model: row.llm_model,
    items,
  };
}

// ---------------------------------------------------------------- scheduler

let running = false;

// Called from the 10-minute tick. Builds whatever is due and missing, for
// every account; anything already snapshotted is skipped for free.
export async function runDueDigests(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = getDb();
    const users = db.prepare("SELECT id FROM users").all() as Array<{
      id: number;
    }>;
    if (users.length === 0) return;

    for (const kind of ["daily", "weekly"] as DigestKind[]) {
      const periodKey = duePeriodKey(kind);
      for (const user of users) {
        if (hasDigest(user.id, kind, periodKey)) continue;
        try {
          await buildDigest(user.id, kind, { periodKey });
        } catch (error) {
          console.error(
            `[digest] ${kind} build failed for user ${user.id}:`,
            error
          );
        }
      }
    }
  } finally {
    running = false;
  }
}
