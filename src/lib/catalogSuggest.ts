import { getDb } from "./db";
import { complete, llmConfigured, rankProviders } from "./llm";
import { discoverFeedUrl, parseFeedMeta, refreshStaleFeeds } from "./rss";
import { CATALOG_SEED } from "./catalogSeed";

// Filling the Discover catalog. Two sources, one door: a curated seed list and
// the model's suggestions. Neither is trusted — every candidate is a home-page
// URL that must resolve to a real, parseable feed through discoverFeedUrl
// before it becomes a row, so a hallucinated domain or a blog that died in
// 2019 simply never arrives.

const VERIFY_CONCURRENCY = 4;
const MAX_SUGGESTIONS_PER_RUN = 25;
const TASTE_SAMPLE = 20;

export interface CatalogAddition {
  name: string;
  url: string;
  feedUrl?: string;
  status: "added" | "duplicate" | "unreachable";
}

function normalizeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Known hosts, so neither source can re-add a subscription or a publication
// the catalog already holds. Matching on host rather than URL catches the
// common case of the same site offered under a different path.
function knownHosts(): Set<string> {
  const rows = getDb()
    .prepare("SELECT url, site_url FROM feeds")
    .all() as Array<{ url: string; site_url: string | null }>;
  const hosts = new Set<string>();
  for (const row of rows) {
    for (const value of [row.url, row.site_url]) {
      const host = value ? normalizeHost(value) : null;
      if (host) hosts.add(host);
    }
  }
  return hosts;
}

// Verify one candidate and, if it holds up, add it as a catalog publication.
async function addCandidate(
  candidate: { name: string; url: string },
  hosts: Set<string>
): Promise<CatalogAddition> {
  const host = normalizeHost(candidate.url);
  if (!host || hosts.has(host)) {
    return { ...candidate, status: "duplicate" };
  }

  const feedUrl = await discoverFeedUrl(candidate.url);
  if (!feedUrl) return { ...candidate, status: "unreachable" };

  const feedHost = normalizeHost(feedUrl);
  if (feedHost && hosts.has(feedHost)) {
    return { ...candidate, status: "duplicate" };
  }

  let meta: { title: string; site_url: string };
  try {
    meta = await parseFeedMeta(feedUrl);
  } catch {
    return { ...candidate, status: "unreachable" };
  }

  const db = getDb();
  if (db.prepare("SELECT 1 FROM feeds WHERE url = ?").get(feedUrl)) {
    return { ...candidate, status: "duplicate" };
  }
  // The feed's own title wins over the suggested name — the model's idea of
  // what a publication is called is not authoritative, the feed is.
  db.prepare(
    "INSERT INTO feeds (title, url, site_url, subscribed) VALUES (?, ?, ?, 0)"
  ).run(meta.title || candidate.name, feedUrl, meta.site_url);
  hosts.add(host);
  if (feedHost) hosts.add(feedHost);
  return { ...candidate, feedUrl, status: "added" };
}

async function addAll(
  candidates: Array<{ name: string; url: string }>
): Promise<CatalogAddition[]> {
  const hosts = knownHosts();
  const queue = [...candidates];
  const results: CatalogAddition[] = [];
  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift()!;
      try {
        results.push(await addCandidate(candidate, hosts));
      } catch {
        results.push({ ...candidate, status: "unreachable" });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, candidates.length) }, worker)
  );
  return results;
}

// Pull articles for whatever was just added, so a new publication has its
// three tiles immediately instead of after the next scheduler tick.
async function warmUp(additions: CatalogAddition[]): Promise<void> {
  const db = getDb();
  for (const addition of additions) {
    if (addition.status !== "added" || !addition.feedUrl) continue;
    const feed = db
      .prepare("SELECT id FROM feeds WHERE url = ?")
      .get(addition.feedUrl) as { id: number } | undefined;
    if (feed) await refreshStaleFeeds(feed.id).catch(() => {});
  }
}

export async function seedCatalog(): Promise<CatalogAddition[]> {
  const results = await addAll(CATALOG_SEED);
  await warmUp(results);
  report("seed", results);
  return results;
}

const SUGGEST_SYSTEM =
  "You recommend publications — magazines, newsletters and blogs — to one " +
  "reader, based on the articles they saved.\n\n" +
  "Match the register of what they save, not merely the subject. If they save " +
  "essays and reported features, suggest places that publish essays and " +
  "reported features. Avoid general news wires, aggregators and gadget-review " +
  "sites unless the saved articles are plainly of that kind — a reader of " +
  "cultural criticism has no use for a consumer-electronics feed.\n\n" +
  "Answer with one publication per line, as `Name | https://homepage`, and " +
  "nothing else: no numbering, no commentary, no markdown. Give the " +
  "publication's home page, not a feed URL and not an article URL. Suggest " +
  "only publications you are confident actually exist, and get the domain " +
  "exactly right.";

function tasteSample(userId: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT e.title FROM user_events e
       WHERE e.user_id = ? AND e.title IS NOT NULL AND e.title != ''
         AND e.action IN ('save','like')
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(userId, TASTE_SAMPLE) as Array<{ title: string }>;
  return rows.map((row) => row.title);
}

function knownPublications(): string[] {
  return (
    getDb().prepare("SELECT title FROM feeds ORDER BY id").all() as Array<{
      title: string;
    }>
  ).map((row) => row.title);
}

// Ask the model for publications like the ones this reader keeps, then let
// discoverFeedUrl be the judge. The model is a source of names, not of truth.
export async function suggestCatalog(userId: number): Promise<CatalogAddition[]> {
  if (!llmConfigured()) return [];
  const taste = tasteSample(userId);
  if (taste.length === 0) return [];

  const known = knownPublications();
  const result = await complete(
    SUGGEST_SYSTEM,
    `Articles this reader saved:\n${taste.map((t) => `- ${t}`).join("\n")}\n\n` +
      `Publications they already have (do not suggest these):\n${known.join(", ")}\n\n` +
      `Suggest up to ${MAX_SUGGESTIONS_PER_RUN} others.`,
    // Generous on purpose: a reasoning model spends part of the budget
    // thinking, and twenty-five lines of output after that does not fit in the
    // few hundred tokens a blurb needs. Too small a budget here comes back
    // empty rather than truncated.
    1500,
    rankProviders()
  );
  if (!result) return [];

  const candidates: Array<{ name: string; url: string }> = [];
  for (const line of result.text.split("\n")) {
    const match = line.match(/^\s*[-*\d.)\s]*(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/);
    if (!match) continue;
    candidates.push({ name: match[1].trim(), url: match[2].trim() });
    if (candidates.length === MAX_SUGGESTIONS_PER_RUN) break;
  }
  if (candidates.length === 0) {
    console.warn(`[catalog] no parseable suggestions: ${result.text.slice(0, 90)}`);
    return [];
  }

  const results = await addAll(candidates);
  await warmUp(results);
  report("suggest", results);
  return results;
}

function report(source: string, results: CatalogAddition[]): void {
  const counts = results.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[catalog] ${source}: ${counts.added ?? 0} added, ` +
      `${counts.duplicate ?? 0} already known, ${counts.unreachable ?? 0} had no usable feed`
  );
  // Name the rejects rather than swallowing them: a suggestion that never
  // resolves is the signal that a source has moved or was invented.
  for (const entry of results.filter((r) => r.status === "unreachable")) {
    console.log(`[catalog]   no feed: ${entry.name} (${entry.url})`);
  }
}
