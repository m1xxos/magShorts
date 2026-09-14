import { getDb, type Article } from "./db";
import { bufferToVector, EMBEDDING_DIM } from "./embeddings";
import {
  isCommerceRoundup,
  rankForDigest,
  COMMERCE_PENALTY,
  FEED_REPEAT_PENALTY,
  NOT_LOCAL_NEWS,
  type DigestCandidate,
} from "./recommend";
import { extractArticle, readContentText } from "./extract";
import { readingMinutes } from "./readingTime";
import { complete, llmConfigured, rankProviders } from "./llm";
import { isEvent, isGrim } from "./cityFilter";
import { currentCity, getCountSetting, getSetting } from "./settings";
import { shiftDate, WEEKDAYS, zonedNow } from "./zoned";
import {
  type DigestDto,
  type DigestItemDto,
  type DigestKind,
  type DigestSection,
} from "./types";

// The city window is two days rather than one. A small city's Sunday can be
// five items, three of them press releases — and an empty window writes no row
// at all, which readDigest answers with the newest row of that kind whatever
// period it belongs to. So a thin day would silently show yesterday's digest
// again. Overlapping the window is cheaper than that.
const WINDOW_HOURS: Record<DigestKind, number> = {
  daily: 24,
  weekly: 24 * 7,
  city: 48,
};

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

// ---------------------------------------------------------------- scheduling

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
  // The city digest keeps the morning digest's hour — one time to configure
  // and one to explain — but its own key prefix. `UNIQUE(user_id, kind,
  // period_key)` already separates them, so this is for whoever reads the
  // table: "w" set the precedent that a bare date means daily.
  if (kind === "city") {
    const at = parseTime(getSetting("digest_daily_at"), 8 * 60);
    return `c${local.minutes >= at ? local.date : shiftDate(local.date, -1)}`;
  }
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

type TextSource = Pick<Article, "id" | "title" | "summary" | "content">;

// What the model (and the bench) actually sees: the stored feed body when the
// feed ships a real one, otherwise the reader's extractor.
//
// This used to strip the tags off the raw page, and the model then summarised
// the furniture along with the article. Measured on The Verge's Fairphone 6
// Plus piece, the old path handed over 4 401 characters that open with the
// "Tech Gadgets News" nav, the byline and the author's biography, and close
// with the "Most Popular" rail — five unrelated headlines and an ad slot — so
// a summary of a phone review could come back mentioning a laptop from the
// sidebar. Through the extractor the same page is 2 791 characters, all of
// them the article. WIRED, whose body is only in the page's JSON, went from a
// truncated 6 000 characters starting "Save this story Save this story" to
// 6 225 of real text.
//
// Scraped text is still never written back to articles.content — that stays
// what the feed published. It lands in article_content, where the reader wants
// it anyway, so annotating a digest also makes those articles open instantly.
// A digest annotates at most thirteen cards, so this is at most thirteen
// extractions, and a cached one is a single SELECT. The exception is a page
// stored 'partial': extractArticle re-runs the whole chain for those by
// design, since a teaser is usually a page that was slow that day, so a feed
// that always answers short pays the hops again on every build.
//
// `extract: false` reads the cache and stops there — see annotate().
export async function articleFullText(
  article: TextSource,
  options: { extract?: boolean } = {}
): Promise<string> {
  const stored = article.content?.trim() ?? "";
  if (stored.length >= TEXT_TRUSTED_LENGTH) return stored.slice(0, TEXT_MAX_LENGTH);

  if (options.extract !== false) {
    // The chain parses hostile HTML and writes SQLite, so unlike the page
    // fetch it replaces it can reject. One article must not cost the whole
    // snapshot: a build that throws here writes no digest at all, while a
    // build that catches loses one card its full text and keeps the rest.
    try {
      await extractArticle(article.id);
    } catch (error) {
      console.log(`[digest] extraction failed for article ${article.id}: ${error}`);
    }
  }
  const extracted = readContentText(article.id) ?? "";
  if (extracted.length >= TEXT_MIN_LENGTH && extracted.length > stored.length) {
    return extracted.slice(0, TEXT_MAX_LENGTH);
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
  /** How many articles fell into this cluster. */
  size: number;
  /** How many *distinct publications* they came from, which is not the same
   *  number and is the one that means anything. */
  outlets: Set<number>;
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
    if (existing) {
      existing.size++;
      existing.outlets.add(article.feed_id);
    } else {
      clusters.push({
        lead: article,
        vector,
        size: 1,
        outlets: new Set([article.feed_id]),
      });
    }
  }
  return clusters;
}

// -------------------------------------------------------- the city's news

// What makes a local story the day's news is not how well it matches your
// taste — there is no taste to match, the profile is built from technology
// writing and knows nothing about a bridge. It is how many of the city's own
// publications thought it worth filing; recency is the tiebreak underneath it.
//
// *Publications*, not articles. A cluster's size counts what fell into it, and
// a rolling bulletin falls into itself: "Новости Петербурга к 11:00", "…к
// 12:00", "…к 13:00" is one outlet talking to itself seven times, which the
// first version of this read as seven outlets agreeing and led the digest
// with. Measured on the live Petersburg corpus, 22 of the 47 clusters bigger
// than one article were a single outlet repeating.
const CORROBORATION_WEIGHT = 0.5;
const RECENCY_WEIGHT = 0.4;
// One concert is never carried by three papers at once, so an event can never
// earn the corroboration a road closure does and would sit below it forever.
// Worth about the same as two publications agreeing.
const EVENT_BONUS = 0.5;
// Three outlets twenty hours ago: 1.00 + 0.4 x 0.17 = 1.07. One outlet an hour
// ago: 0.50 + 0.4 x 0.96 = 0.88. Corroboration wins, which is what "rank by
// what happened" has to mean — at a recency weight of 1.0 it does not, so this
// ratio is the feature rather than a constant to tune blindly.

function fetchCityCandidates(city: string, hours: number): DigestCandidate[] {
  // Deliberately not fetchCandidates(): that one is scoped to subscribed = 1,
  // drops anything the reader has already touched, and honours the folder
  // toggles. None of the three applies here — the city digest spans every
  // local publication, and what you have already read is your business rather
  // than the ranking's.
  //
  // `embedding IS NOT NULL` is load-bearing: clusterStories reads the buffer
  // with no null check, and a publication found this morning has articles
  // before it has vectors.
  const rows = getDb()
    .prepare(
      `SELECT a.*, f.title AS feed_title
         FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE f.city = ? AND f.enabled = 1
          AND a.embedding IS NOT NULL
          AND a.published_at >= datetime('now', ?)
        ORDER BY a.published_at DESC`
    )
    .all(city, `-${hours} hours`) as DigestCandidate[];

  // Filtered here rather than while laying out the cards, so that what is
  // dropped is dropped from the quick hits and from behind "Show all N" too.
  // There is no point refusing to lead with a stabbing and then listing it
  // four rows further down.
  return rows.filter((article) => !isGrim(article.title, article.summary));
}

function rankCityStories(city: string, hours: number): Cluster[] {
  // Clustered newest-first, so the freshest telling of a story leads it — the
  // reverse of the main digest, which clusters an already-ranked list.
  const clusters = clusterStories(fetchCityCandidates(city, hours));
  if (clusters.length === 0) return [];

  const windowMs = hours * 3_600_000;
  const now = Date.now();
  const scored = clusters.map((cluster) => {
    const published = cluster.lead.published_at
      ? new Date(cluster.lead.published_at).getTime()
      : now - windowMs;
    const recency = Math.max(0, Math.min(1, 1 - (now - published) / windowMs));
    return {
      cluster,
      score:
        CORROBORATION_WEIGHT * Math.log2(cluster.outlets.size + 1) +
        RECENCY_WEIGHT * recency +
        (isEvent(cluster.lead.title, cluster.lead.summary) ? EVENT_BONUS : 0) -
        (isCommerceRoundup(cluster.lead.title) ? COMMERCE_PENALTY : 0),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return spreadByFeed(scored);
}

// The greedy pass the grid uses: take the best, then dock every later story
// from that publication a little, so one outlet that files constantly cannot
// own the page.
function spreadByFeed(
  scored: Array<{ cluster: Cluster; score: number }>,
  penalty = FEED_REPEAT_PENALTY
): Cluster[] {
  const picked: Cluster[] = [];
  const perFeed = new Map<number, number>();
  const pool = [...scored];
  while (pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const seen = perFeed.get(pool[i].cluster.lead.feed_id) ?? 0;
      const adjusted = pool[i].score - seen * penalty;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = i;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    perFeed.set(
      chosen.cluster.lead.feed_id,
      (perFeed.get(chosen.cluster.lead.feed_id) ?? 0) + 1
    );
    picked.push(chosen.cluster);
  }
  return picked;
}

// No publication may take more than its share of the cards on the page.
//
// A per-repeat penalty is the wrong tool here and was tried first: positions
// on a seven-card page are worth about .14 of each other, so breaking a stack
// six deep needs a penalty big enough to override the model everywhere else
// too. A share is the thing actually being asked for, so it is what is
// written: with seven cards and three publications nobody takes more than
// three, and the rest wait their turn behind the cards that fit.
//
// Order within a publication is untouched, so the model's judgement of which
// of its stories matters most survives intact — and when only one publication
// has anything left, it fills the page rather than leaving it short.
export function capPerFeed(clusters: Cluster[], need: number): Cluster[] {
  // Every publication with a story to offer, not a prefix of them: counting
  // only the first so many would read a run of one outlet at the top as
  // "there is only one outlet" and lift the cap exactly where it is needed.
  const outlets = new Set(clusters.map((cluster) => cluster.lead.feed_id));
  const cap = Math.max(1, Math.ceil(need / Math.max(1, outlets.size)));

  const kept: Cluster[] = [];
  const deferred: Cluster[] = [];
  const used = new Map<number, number>();
  for (const cluster of clusters) {
    const feed = cluster.lead.feed_id;
    const taken = used.get(feed) ?? 0;
    if (kept.length < need && taken < cap) {
      used.set(feed, taken + 1);
      kept.push(cluster);
    } else {
      deferred.push(cluster);
    }
  }
  return [...kept, ...deferred];
}

const CITY_RERANK_SYSTEM =
  "You are choosing what to put in front of someone who wants to know what is " +
  "going on in the city they live in — what is on, what has opened, what has " +
  "been built or restored, what people there did well at.\n" +
  "Position 1 is the lead: the thing most worth knowing about or going to.\n" +
  "Prefer what is happening or about to happen over what someone said about " +
  "it, and the city's own life over national news carried by a local paper.\n" +
  "Never pick a story about war, fighting, weapons, a killing, an assault, a " +
  "crime, a court case, a crash, a fire or anyone's death. Not as the lead, " +
  "not anywhere. If a story is mostly one of those, leave its number out " +
  "entirely even if nothing else is left to pick.\n" +
  "Never pick advertising, listings or promotional content. Prefer variety of " +
  "subject and of publication.\n" +
  "Answer with the numbers only, separated by commas, best first. No words, " +
  "no explanation, no formatting.";

// Forked from rerankClusters rather than shared: that one hands the model the
// titles you saved and asks for at least two you would pick for yourself,
// which is the opposite of the question here. Same posture though — it can
// only reorder, and a failed or unparseable answer leaves the scored order
// alone, which for this ranker is already a real answer.
async function rerankCityClusters(
  clusters: Cluster[],
  city: string,
  need: number
): Promise<Cluster[]> {
  const providers = rankProviders();
  if (
    getSetting("digest_rerank") === "off" ||
    providers.length === 0 ||
    clusters.length <= need
  ) {
    return clusters;
  }

  const shortlist = clusters.slice(0, SHORTLIST_SIZE);
  const listing = shortlist
    .map(
      (cluster, index) =>
        `${index + 1}. ${cluster.lead.title}` +
        (cluster.size > 1 ? ` [${cluster.size} publications]` : "")
    )
    .join("\n");

  const result = await complete(
    CITY_RERANK_SYSTEM,
    `City: ${city}\n\nToday in ${city}:\n${listing}\n\n` +
      `Answer with the ${need} best, best first.`,
    RANK_TOKENS,
    providers
  );
  if (!result) return clusters;

  const order = (result.text.match(/\d+/g) ?? [])
    .map((value) => Number(value) - 1)
    .filter((index) => index >= 0 && index < shortlist.length);
  const seen = new Set<number>();
  const picked: Cluster[] = [];
  for (const index of order) {
    if (seen.has(index)) continue;
    seen.add(index);
    picked.push(shortlist[index]);
  }
  if (picked.length === 0) return clusters;

  // The diversity pass has to run again here, and this is the whole reason
  // the city digest went out with all seven cards from one broadcaster. The
  // scored order handed to the model was well mixed — Телеканал, Фонтанка,
  // Телеканал, ДП, Фонтанка… — and the model reordered it freely, stacking
  // one outlet, because "prefer variety of publication" in a prompt is a
  // request and not a constraint. Its judgement of what matters is kept: the
  // position it gave a story is the score, and only the tie between outlets
  // is broken.
  const capped = capPerFeed(picked, need);
  return [...capped, ...clusters.filter((_, i) => !seen.has(i))];
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

const THREE_LINES_BODY =
  "You write the 'In three lines' panel of a news digest: three " +
  "observations about the day's news taken as a whole — what several " +
  "publications converged on, what is missing, what is unusually quiet. They " +
  "are observations, not headlines, and not a list of the articles. Answer " +
  "with exactly three lines, one sentence each, separated by newlines. " +
  "No markdown, no numbering, no preamble.";

// The language is the one instruction that cannot be shared. A reader's own
// digest spans publications in several languages and English is the one they
// have in common; a city's press has exactly one, and an English panel over
// Russian cards would read like a translation nobody asked for.
const THREE_LINES_SYSTEM = `${THREE_LINES_BODY} Write in English.`;
const CITY_THREE_LINES_SYSTEM = `${THREE_LINES_BODY} Write in the same language as the headlines.`;

// --------------------------------------------------------------- reranking

// How many cluster representatives the model gets to choose from. Thirty with
// one-line summaries is about 3 000 tokens — a quarter of a minute's budget,
// where the whole day's pool with summaries would be 11 600 and a week's
// 43 000.
// Budgets for the two calls that answer in a few words.
//
// They were 120 and 260, which is generous for the answer and not for how it
// is arrived at: a reasoning model spends the same budget thinking first, and
// gpt-oss-120b returned "empty completion" for both on a real digest — the
// whole allowance went on reasoning that stripReasoning then removed, leaving
// nothing and dropping the summary panel to its English template. Tripled,
// which costs nothing when the answer is three lines long and the tokens are
// only spent if they are used.
const RANK_TOKENS = 400;
const THREE_LINES_TOKENS = 800;

const SHORTLIST_SIZE = 30;

const RERANK_SYSTEM =
  "You are choosing the articles worth one reader's five minutes this " +
  "morning, out of everything their feeds published. You are given the " +
  "candidates and a sample of what this reader saved or liked recently.\n\n" +
  "Position 1 is the lead: the single most significant thing here — " +
  "something that happened, or a story several publications ran at once.\n" +
  "Of the remaining picks, at least two must be ones this particular reader " +
  "would choose for themselves even if they are not important news.\n" +
  "Never pick shopping content: promo codes, deals, buying guides, product " +
  "roundups, gift guides.\n" +
  "Prefer variety of subject and of publication.\n\n" +
  "Answer with the numbers only, separated by commas, best first. No words, " +
  "no explanation, no formatting.";

// The reader's taste, stated as evidence rather than as an adjective: the
// titles they actually kept. Cheaper and far more specific than asking a model
// to describe them first.
function tasteTitles(userId: number, limit = 15): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT e.title FROM user_events e
       WHERE e.user_id = ? AND e.title IS NOT NULL AND e.title != ''
         AND e.action IN ('save','like')
         ${NOT_LOCAL_NEWS}
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(userId, limit) as Array<{ title: string }>;
  return rows.map((row) => row.title);
}

function shortlistLine(cluster: Cluster, index: number): string {
  const article = cluster.lead;
  const teaser = firstSentences(article.summary ?? "", 1).slice(0, 160);
  return (
    `[${index + 1}] ${article.feed_title ?? "?"} · ${article.title}` +
    (teaser ? ` — ${teaser}` : "") +
    (cluster.size > 1 ? ` (+${cluster.size - 1} similar)` : "")
  );
}

// Reorders the clusters so the model's picks come first. It can only reorder:
// an unparseable, empty or truncated answer leaves the ranking exactly as the
// scoring layers left it, and every index is validated before use.
async function rerankClusters(
  clusters: Cluster[],
  userId: number,
  need: number
): Promise<Cluster[]> {
  if (getSetting("digest_rerank") === "off") return clusters;
  const providers = rankProviders();
  if (providers.length === 0 || clusters.length <= need) return clusters;

  const shortlist = clusters.slice(0, SHORTLIST_SIZE);
  const taste = tasteTitles(userId);
  const prompt =
    (taste.length > 0
      ? `This reader recently saved or liked:\n${taste
          .map((title) => `- ${title}`)
          .join("\n")}\n\n`
      : "") +
    `Pick ${need} of these ${shortlist.length} candidates:\n` +
    shortlist.map(shortlistLine).join("\n");

  const result = await complete(RERANK_SYSTEM, prompt, RANK_TOKENS, providers);
  if (!result) return clusters;

  const picked: Cluster[] = [];
  const seen = new Set<number>();
  for (const match of result.text.matchAll(/\d+/g)) {
    const index = Number(match[0]) - 1;
    if (index < 0 || index >= shortlist.length || seen.has(index)) continue;
    seen.add(index);
    picked.push(shortlist[index]);
    if (picked.length === need) break;
  }
  if (picked.length === 0) {
    console.warn(`[digest] rerank returned nothing usable: ${result.text.slice(0, 80)}`);
    return clusters;
  }

  console.log(
    `[digest] reranked by ${result.model}: picked ${[...seen].map((i) => i + 1).join(",")}`
  );
  // Anything it didn't pick keeps its scored order behind the picks, so a
  // short answer still fills the digest.
  return [...picked, ...clusters.filter((cluster) => !picked.includes(cluster))];
}

// Demotion alone can still leave a roundup on top of a quiet day, and the
// digest should never *open* with a coupon page. Swaps in the best editorial
// story instead, leaving everything else where it was.
function promoteEditorialLead(clusters: Cluster[]): Cluster[] {
  if (clusters.length === 0 || !isCommerceRoundup(clusters[0].lead.title)) {
    return clusters;
  }
  const replacement = clusters.findIndex(
    (cluster) => !isCommerceRoundup(cluster.lead.title)
  );
  if (replacement < 0) return clusters;
  const reordered = [...clusters];
  [reordered[0], reordered[replacement]] = [
    reordered[replacement],
    reordered[0],
  ];
  console.log(`[digest] lead was a roundup — promoted "${reordered[0].lead.title.slice(0, 50)}"`);
  return reordered;
}

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
  // With no model configured the digest is extractive and the full text buys
  // only the reading time — not worth thirteen page fetches on a schedule the
  // user never asked for. The cache is still read, so an article the reader
  // has already opened keeps its real minutes.
  const configured = llmConfigured();
  const text = await articleFullText(article, { extract: configured });
  const minutes = readingMinutes(text);
  const extractive = firstSentences(teaserSource(article), sentences);
  if (!configured) {
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
  const period =
    kind === "weekly"
      ? "over the past week"
      : kind === "city"
      ? "in the last two days"
      : "since yesterday";
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
    kind === "city" ? CITY_THREE_LINES_SYSTEM : THREE_LINES_SYSTEM,
    `${articleCount} articles from ${publicationCount} publications.\n\n${lines}`,
    THREE_LINES_TOKENS
  );
  if (!result) return { lines: fallback, wrote: null };

  // Asked for three lines, the model sometimes answers with three sentences on
  // one line. That is the answer, written slightly wrong, and throwing it away
  // for a template that says "208 articles from 3 publications" is the worse
  // reading of it — so a single line is split on sentence endings before
  // giving up.
  const byLine = result.text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
  const parsed =
    byLine.length >= 3
      ? byLine
      : byLine
          .join(" ")
          .split(/(?<=[.!?])\s+(?=[«"'"'(\p{Lu}])/u)
          .map((sentence) => sentence.trim())
          .filter(Boolean);
  if (parsed.length < 3) {
    // The panel silently becomes its English template when this happens, which
    // is indistinguishable on screen from having no model at all. Say which it
    // was, and say what came back instead of three lines.
    console.warn(
      `[digest] three-lines answer was ${parsed.length} line(s), using the template: ` +
        JSON.stringify(result.text.slice(0, 200))
    );
    return { lines: fallback, wrote: null };
  }
  return {
    lines: parsed.slice(0, 3),
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
  const city = kind === "city" ? currentCity() : "";
  if (kind === "city" && !city) return null;

  const { also: alsoCount, quick: quickCount } = digestSizes();

  // The two kinds differ in how they rank and in nothing else: the clustering,
  // the annotations, the summary panel and the write are the same code.
  let scoredClusters: Cluster[];
  let articleCount: number;
  let publications: number;
  if (kind === "city") {
    scoredClusters = rankCityStories(city, hours);
    if (scoredClusters.length === 0) return null;
    const pool = fetchCityCandidates(city, hours);
    articleCount = pool.length;
    publications = new Set(pool.map((article) => article.feed_id)).size;
  } else {
    const ranked = rankForDigest(userId, hours);
    if (ranked.length === 0) return null;
    scoredClusters = clusterStories(ranked);
    articleCount = ranked.length;
    publications = new Set(ranked.map((article) => article.feed_id)).size;
  }

  const clusters =
    kind === "city"
      ? promoteEditorialLead(
          await rerankCityClusters(scoredClusters, city, LEAD_COUNT + alsoCount)
        )
      : promoteEditorialLead(
          await rerankClusters(scoredClusters, userId, LEAD_COUNT + alsoCount)
        );
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
    articleCount,
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
        articleCount,
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
      `${clusters.length} stories from ${articleCount} articles`
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

    // The city digest last. buildDigest is serialised process-wide, so a city
    // digest built first would delay the morning one by its own LLM calls —
    // minutes, on a box running the model locally. The morning digest is the
    // one with a promise attached to its hour.
    for (const kind of ["daily", "weekly", "city"] as DigestKind[]) {
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
