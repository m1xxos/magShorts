// Everything "Your reading" shows, derived on the spot.
//
// There is no stats table and there should not be one: every figure here is a
// count over user_events, reading_list and article_content, all of which are
// small and already indexed for exactly this shape of question. A cached
// summary would only be one more thing that can disagree with the events it
// summarises.

import { getDb } from "./db";
import { digestTimeZone } from "./digest";
import {
  type ReadingStatsDto,
  type StatsBucketDto,
  type StatsFeedDto,
  type StatsRange,
  type StatsTopicDto,
} from "./types";
import { shiftDate, zonedNow } from "./zoned";

interface RangeSpec {
  days: number;
  buckets: number;
  bucket: "day" | "month";
  // How far back the topic card looks. Deliberately wider than the range: a
  // week of titles has nothing to say about what anyone is interested in, and
  // an empty card teaches the reader the feature is broken.
  topicDays: number;
}

const RANGES: Record<StatsRange, RangeSpec> = {
  week: { days: 7, buckets: 7, bucket: "day", topicDays: 30 },
  month: { days: 30, buckets: 30, bucket: "day", topicDays: 90 },
  year: { days: 365, buckets: 12, bucket: "month", topicDays: 365 },
};

export const STATS_RANGES = Object.keys(RANGES) as StatsRange[];

export function isStatsRange(value: string): value is StatsRange {
  return value in RANGES;
}

// Opening an article, finishing one, and the timed record of having read it.
// Three actions, one meaning: this article was read.
const READ = new Set(["open", "dwell", "read"]);
// An article opened but never finished. There is no honest number here — the
// scroll position lives in localStorage and the server cannot see it — so this
// is a stated assumption rather than a measurement, and it only ever applies
// to events recorded before the reader started timing itself.
const PARTIAL_SHARE = 0.35;
// What an article is worth when it was never extracted and has no word count.
const UNKNOWN_MINUTES = 5;

interface EventRow {
  link: string;
  action: string;
  created_at: string;
  feed_id: number | null;
  title: string | null;
  seconds: number | null;
}

// The database stores "YYYY-MM-DD HH:MM:SS" in UTC with no marker, which JS
// otherwise reads as local time.
function parseStamp(value: string): Date {
  return new Date(value.replace(" ", "T") + "Z");
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
  });
}

function dayLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// The buckets the chart draws, oldest first, including the empty ones — a week
// with three reading days is a fact about the week, not three bars.
function emptyBuckets(today: string, spec: RangeSpec): StatsBucketDto[] {
  const buckets: StatsBucketDto[] = [];
  if (spec.bucket === "day") {
    for (let index = spec.buckets - 1; index >= 0; index--) {
      const key = shiftDate(today, -index);
      buckets.push({ key, label: dayLabel(key), count: 0 });
    }
    return buckets;
  }
  const [year, month] = today.split("-").map(Number);
  for (let index = spec.buckets - 1; index >= 0; index--) {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const key = date.toISOString().slice(0, 7);
    buckets.push({ key, label: monthLabel(key), count: 0 });
  }
  return buckets;
}

function bucketKey(date: string, bucket: "day" | "month"): string {
  return bucket === "day" ? date : date.slice(0, 7);
}

export function readingStats(
  userId: number,
  range: StatsRange
): ReadingStatsDto {
  const db = getDb();
  const spec = RANGES[range];
  const timeZone = digestTimeZone();
  const today = zonedNow(new Date(), timeZone).date;

  // Two windows of equal length, so the range can be compared with the one
  // before it. Fetched together and split in JS: one indexed scan beats two.
  const start = shiftDate(today, -(spec.days - 1));
  const previousStart = shiftDate(start, -spec.days);
  // A day either side, because the zoned day boundary is not the UTC one.
  const cutoff = `${shiftDate(previousStart, -1)} 00:00:00`;

  const rows = db
    .prepare(
      `SELECT link, action, created_at, feed_id, title, seconds
         FROM user_events
        WHERE user_id = ? AND created_at >= ?`
    )
    .all(userId, cutoff) as EventRow[];

  const buckets = emptyBuckets(today, spec);
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const perBucket = new Map<string, Set<string>>();
  const readLinks = new Set<string>();
  const readBefore = new Set<string>();
  const finishedLinks = new Set<string>();
  const measured = new Map<string, number>();
  const feedLinks = new Map<number, Set<string>>();
  // Counted per calendar day whatever the chart's bucket is: with month
  // buckets, deduplicating alongside the bars would credit a whole month of
  // reading to the weekday its first article happened to land on.
  const perWeekday = new Array<number>(7).fill(0);
  const weekdayCounted = new Set<string>();

  for (const row of rows) {
    if (!READ.has(row.action)) continue;
    const zoned = zonedNow(parseStamp(row.created_at), timeZone);
    if (zoned.date < previousStart) continue;

    if (zoned.date < start) {
      readBefore.add(row.link);
      continue;
    }

    readLinks.add(row.link);
    if (row.action === "dwell") finishedLinks.add(row.link);
    if (row.seconds) {
      // Two sittings with the same article add up; a second event for a
      // sitting already counted would not, but the reader only sends one.
      measured.set(row.link, (measured.get(row.link) ?? 0) + row.seconds);
    }

    const key = bucketKey(zoned.date, spec.bucket);
    const seen = perBucket.get(key) ?? new Set<string>();
    if (!seen.has(row.link)) {
      seen.add(row.link);
      perBucket.set(key, seen);
      const bucket = byKey.get(key);
      if (bucket) bucket.count++;
    }

    const day = `${zoned.date}|${row.link}`;
    if (!weekdayCounted.has(day)) {
      weekdayCounted.add(day);
      perWeekday[zoned.weekday]++;
    }

    if (row.feed_id !== null) {
      const links = feedLinks.get(row.feed_id) ?? new Set<string>();
      links.add(row.link);
      feedLinks.set(row.feed_id, links);
    }
  }

  return {
    range,
    articles_read: readLinks.size,
    articles_read_before: readBefore.size,
    ...readingSeconds(db, readLinks, finishedLinks, measured),
    days_counted: daysCounted(db, userId, timeZone, today, spec.days),
    ...savedCounts(db, userId, start, finishedLinks),
    ...streaks(db, userId, timeZone, today),
    by_bucket: buckets,
    by_feed: topFeeds(db, feedLinks),
    ...topicProfile(db, userId, spec.topicDays),
    note: chartNote(buckets, perWeekday, readLinks.size, spec),
  };
}

// How many days of the range this reader was actually around for. A per-day
// average over days nobody could have read on is not an average of anything.
function daysCounted(
  db: ReturnType<typeof getDb>,
  userId: number,
  timeZone: string,
  today: string,
  days: number
): number {
  const first = db
    .prepare(
      "SELECT MIN(created_at) AS at FROM user_events WHERE user_id = ?"
    )
    .get(userId) as { at: string | null };
  if (!first.at) return days;
  const since = zonedNow(parseStamp(first.at), timeZone).date;
  let counted = 1;
  for (let cursor = today; cursor > since && counted < days; counted++) {
    cursor = shiftDate(cursor, -1);
  }
  return counted;
}

// Measured where the reader timed itself, estimated where it did not. The two
// are returned separately because the card says which is which.
function readingSeconds(
  db: ReturnType<typeof getDb>,
  readLinks: Set<string>,
  finishedLinks: Set<string>,
  measured: Map<string, number>
): { seconds_reading: number; seconds_measured: number } {
  let secondsMeasured = 0;
  for (const seconds of measured.values()) secondsMeasured += seconds;

  const guessing = [...readLinks].filter((link) => !measured.has(link));
  if (guessing.length === 0) {
    return {
      seconds_reading: Math.round(secondsMeasured),
      seconds_measured: Math.round(secondsMeasured),
    };
  }

  const minutes = new Map<string, number>();
  // SQLite's parameter limit is in the thousands; a range this size is never
  // close, and chunking would only hide the day it were.
  const placeholders = guessing.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT a.link AS link, ac.reading_minutes AS minutes
         FROM article_content ac
         JOIN articles a ON a.id = ac.article_id
        WHERE a.link IN (${placeholders}) AND ac.reading_minutes IS NOT NULL`
    )
    .all(...guessing) as Array<{ link: string; minutes: number }>;
  for (const row of rows) minutes.set(row.link, row.minutes);

  let estimated = 0;
  for (const link of guessing) {
    const wordCount = minutes.get(link) ?? UNKNOWN_MINUTES;
    estimated += wordCount * 60 * (finishedLinks.has(link) ? 1 : PARTIAL_SHARE);
  }

  return {
    seconds_reading: Math.round(secondsMeasured + estimated),
    seconds_measured: Math.round(secondsMeasured),
  };
}

function savedCounts(
  db: ReturnType<typeof getDb>,
  userId: number,
  start: string,
  finishedLinks: Set<string>
): { saved: number; finished: number; waiting: number } {
  const saved = db
    .prepare(
      "SELECT COUNT(*) AS n FROM reading_list WHERE user_id = ? AND added_at >= ?"
    )
    .get(userId, `${start} 00:00:00`) as { n: number };
  // Waiting is about the pile as it stands, not about the range: "what have I
  // saved and not read" does not become a different question in a week.
  const waiting = db
    .prepare(
      `SELECT COUNT(*) AS n FROM reading_list r
        WHERE r.user_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM user_events e
             WHERE e.user_id = r.user_id AND e.link = r.link AND e.action = 'dwell'
          )`
    )
    .get(userId) as { n: number };
  return { saved: saved.n, finished: finishedLinks.size, waiting: waiting.n };
}

// Consecutive days with something read. Today not counting yet is not a broken
// streak — it is the morning — so the walk may start on yesterday.
function streaks(
  db: ReturnType<typeof getDb>,
  userId: number,
  timeZone: string,
  today: string
): { streak_days: number; streak_best: number } {
  const rows = db
    .prepare(
      `SELECT DISTINCT created_at FROM user_events
        WHERE user_id = ? AND action IN ('open', 'dwell', 'read')`
    )
    .all(userId) as Array<{ created_at: string }>;

  const days = new Set<string>();
  for (const row of rows) {
    days.add(zonedNow(parseStamp(row.created_at), timeZone).date);
  }
  if (days.size === 0) return { streak_days: 0, streak_best: 0 };

  let current = 0;
  let cursor = days.has(today) ? today : shiftDate(today, -1);
  while (days.has(cursor)) {
    current++;
    cursor = shiftDate(cursor, -1);
  }

  let best = 0;
  const sorted = [...days].sort();
  let run = 0;
  let previous = "";
  for (const day of sorted) {
    run = previous && shiftDate(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }

  return { streak_days: current, streak_best: best };
}

function topFeeds(
  db: ReturnType<typeof getDb>,
  feedLinks: Map<number, Set<string>>
): StatsFeedDto[] {
  const ranked = [...feedLinks]
    .map(([feedId, links]) => ({ feed_id: feedId, count: links.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  if (ranked.length === 0) return [];

  const titles = new Map<number, string>();
  const rows = db
    .prepare(
      `SELECT id, title FROM feeds WHERE id IN (${ranked.map(() => "?").join(",")})`
    )
    .all(...ranked.map((entry) => entry.feed_id)) as Array<{
    id: number;
    title: string;
  }>;
  for (const row of rows) titles.set(row.id, row.title);

  return ranked.map((entry) => ({
    ...entry,
    title: titles.get(entry.feed_id) ?? "Unknown",
  }));
}

// Words that carry no topic. Both languages, because the titles in this
// database are both languages — and a handful of publishing furniture on top
// ("часть", "перевод"), which is title boilerplate rather than a subject and
// otherwise ranks as one of the strongest topics on the page.
const STOPWORDS = new Set(
  (
    "about after again also another back been before being best better could " +
    "does doing done down even every first from getting going have here into " +
    "just know last life like made make makes many more most much need never " +
    "next only other over people really said says should some still such take " +
    "than that them then there these they thing things think this those time " +
    "times used using very want week were what when where which while will " +
    "with without work works world would year years your " +
    "будет было быть более всего если ещё еще есть каждый как какие когда " +
    "который которые может можно надо наши него нужно один одна опыт после " +
    "потом почему просто свои свой себя сделать стало такое только через что " +
    "чтобы этот эта эти это " +
    "часть перевод версии статья статье обзор итоги"
  ).split(" ")
);

// A term has to turn up in three separate titles before it is a topic. At two
// the list fills with coincidences — "motion", "nature", "переписал" — which
// is worse than an honest silence.
const MIN_DOCUMENT_FREQUENCY = 3;
const MIN_TOPICS = 3;
const MAX_TOPICS = 6;
// The prior that keeps a term seen twice in a tiny corpus from outranking a
// term seen four times in a large one.
const PRIOR = 4;
const RISING = 1.5;
const SUPPRESSED = 2;

function terms(title: string): Set<string> {
  const found = new Set<string>();
  for (const word of title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    found.add(word);
  }
  return found;
}

function documentFrequency(titles: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const title of titles) {
    for (const term of terms(title)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return counts;
}

// What the recommender learned, said in words.
//
// The profile itself is an embedding — 384 numbers with no names on them — so
// this does not read it. It asks the same question a different way: which
// words appear in the titles you open far more often than in everything that
// arrived? Log-odds with an informative prior, which is the standard answer to
// "this word is rare everywhere, is it really your topic".
function topicProfile(
  db: ReturnType<typeof getDb>,
  userId: number,
  days: number
): { topics: StatsTopicDto[]; signal_count: number } {
  const since = `-${days} days`;
  const positive = db
    .prepare(
      `SELECT DISTINCT link, title, created_at FROM user_events
        WHERE user_id = ? AND title IS NOT NULL AND title != ''
          AND action IN ('open', 'dwell', 'read', 'like', 'save')
          AND created_at >= datetime('now', ?)`
    )
    .all(userId, since) as Array<{
    link: string;
    title: string;
    created_at: string;
  }>;

  // One title per article, however many times it was touched.
  const seen = new Map<string, { title: string; at: number }>();
  for (const row of positive) {
    const at = parseStamp(row.created_at).getTime();
    const existing = seen.get(row.link);
    if (!existing || at > existing.at) seen.set(row.link, { title: row.title, at });
  }
  const signalCount = seen.size;
  if (signalCount === 0) return { topics: [], signal_count: 0 };

  const negative = db
    .prepare(
      `SELECT DISTINCT title FROM user_events
        WHERE user_id = ? AND title IS NOT NULL AND title != ''
          AND action IN ('skip', 'dislike')
          AND created_at >= datetime('now', ?)`
    )
    .all(userId, since) as Array<{ title: string }>;

  const corpus = db
    .prepare(
      `SELECT title FROM articles
        WHERE published_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`
    )
    .all(since) as Array<{ title: string }>;

  const positiveTitles = [...seen.values()].map((entry) => entry.title);
  const dfPositive = documentFrequency(positiveTitles);
  const dfNegative = documentFrequency(negative.map((row) => row.title));
  const dfCorpus = documentFrequency(corpus.map((row) => row.title));

  // The last third of the window against the first two, for the arrow.
  const cutoff = Date.now() - (days / 3) * 86_400_000;
  const recent = [...seen.values()].filter((entry) => entry.at >= cutoff);
  const dfRecent = documentFrequency(recent.map((entry) => entry.title));
  const recentShare = recent.length / positiveTitles.length;

  const total = positiveTitles.length;
  const corpusTotal = Math.max(corpus.length, total);

  const scored: Array<{ term: string; score: number; direction: StatsTopicDto["direction"] }> = [];
  for (const [term, count] of dfPositive) {
    if (count < MIN_DOCUMENT_FREQUENCY) continue;
    const inCorpus = Math.max(dfCorpus.get(term) ?? 0, count);
    const score =
      Math.log(
        (count + PRIOR) /
          (total + PRIOR * 2) /
          ((inCorpus + PRIOR) / (corpusTotal + PRIOR * 2))
      ) * Math.sqrt(count);
    if (score <= 0) continue;

    const negatives = dfNegative.get(term) ?? 0;
    const share = (dfRecent.get(term) ?? 0) / count;
    scored.push({
      term,
      score,
      direction:
        negatives >= count * SUPPRESSED
          ? "suppressed"
          : recentShare > 0 && share >= recentShare * RISING
            ? "up"
            : "steady",
    });
  }

  scored.sort((a, b) => b.score - a.score);
  // Three tags or none: two words in a card headed "What For you learned" read
  // as a bug, and the honest version of "not enough yet" is to say so.
  if (scored.length < MIN_TOPICS) return { topics: [], signal_count: signalCount };

  return {
    topics: scored
      .slice(0, MAX_TOPICS)
      .map(({ term, direction }) => ({ term, direction })),
    signal_count: signalCount,
  };
}

const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

// The sentence under the chart. Generated from the same numbers the bars are
// drawn from, so it can never claim something the chart contradicts.
function chartNote(
  buckets: StatsBucketDto[],
  perWeekday: number[],
  total: number,
  spec: RangeSpec
): string {
  if (total === 0) return "Nothing read in this stretch yet.";

  const active = buckets.filter((bucket) => bucket.count > 0).length;
  const unit = spec.bucket === "day" ? "days" : "months";
  const fallback = `You read on ${active} of the last ${spec.buckets} ${unit}.`;

  const peak = perWeekday.indexOf(Math.max(...perWeekday));
  const average = perWeekday.reduce((sum, count) => sum + count, 0) / 7;
  if (average === 0 || perWeekday[peak] < average * RISING) return fallback;

  const times = perWeekday[peak] / average;
  const ratio =
    times >= 2.5 ? "well over twice" : times >= 1.8 ? "about twice" : "half again";
  return `You read most on ${WEEKDAY_NAMES[peak]} — ${ratio} your usual day.`;
}
