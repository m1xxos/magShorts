import { getDb } from "./db";
import { complete, llmConfigured, llmProviders } from "./llm";
import { catalogSize } from "./catalog";
import { discoverFeedUrl, parseFeedMeta, refreshStaleFeeds } from "./rss";
import { CATALOG_SEED } from "./catalogSeed";

// Filling the Discover catalog. Two sources, one door: a curated seed list and
// the model's suggestions. Neither is trusted — every candidate is a home-page
// URL that must resolve to a real, parseable feed through discoverFeedUrl
// before it becomes a row, so a hallucinated domain or a blog that died in
// 2019 simply never arrives.

const VERIFY_CONCURRENCY = 4;
const MAX_SUGGESTIONS_PER_RUN = 25;
// A window, not the whole history: a different slice each run is what stops
// the model answering with the same canonical dozen every day (see BRIEFS).
const TASTE_WINDOW = 12;

// How often the scheduler is allowed to ask for more, and how big the catalog
// is allowed to get. Without the ceiling the daily run grows it forever, and
// every catalog publication costs a feed refresh every six hours.
const SUGGEST_EVERY_MS = 24 * 3_600_000;
const CATALOG_CEILING = Number(process.env.CATALOG_MAX ?? 120);

// Bookkeeping rows in `settings`. Deliberately not SettingKeys: these are the
// replenisher's own notes, not something to show in the settings dialog.
const LAST_RUN_KEY = "catalog_suggested_at";
const RUN_COUNT_KEY = "catalog_suggest_runs";
const DEAD_HOSTS_KEY = "catalog_dead_hosts";
const DISMISSED_HOSTS_KEY = "catalog_dismissed_hosts";
// Remembering more than this is pointless — the model stops naming a domain
// long before the list gets there, and the prompt has to carry it.
const DEAD_HOSTS_MEMORY = 120;
// Refusals are worth keeping much longer than failures: a domain that didn't
// resolve may come back, but a publication the reader threw out is a judgement
// that doesn't expire.
const DISMISSED_MEMORY = 500;

export interface CatalogAddition {
  name: string;
  url: string;
  feedUrl?: string;
  status: "added" | "duplicate" | "unreachable" | "mismatch";
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
//
// Publications the reader has thrown out count as known. Nothing else would
// hold: the model that suggested one today is the same model tomorrow, and a
// catalog that keeps filling itself has to remember being told no — otherwise
// dismissing a publication buys a day.
function knownHosts(): Set<string> {
  const rows = getDb()
    .prepare("SELECT url, site_url FROM feeds")
    .all() as Array<{ url: string; site_url: string | null }>;
  const hosts = dismissedHosts();
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
  candidates: Array<{ name: string; url: string }>,
  skip: Set<string> = new Set()
): Promise<CatalogAddition[]> {
  const hosts = knownHosts();
  // Small models loop: one run answered with the same publication thirteen
  // times. Collapsing by host first means a stutter costs one lookup, not
  // thirteen — and drops whatever the caller already knows to be dead.
  const queue: Array<{ name: string; url: string }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const host = normalizeHost(candidate.url);
    if (!host || seen.has(host) || skip.has(host)) continue;
    seen.add(host);
    queue.push(candidate);
  }
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
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, queue.length) }, worker)
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
  "Name whole publications with their own home page. Not a section of a " +
  "larger paper, not a tag or topic page, not a feed URL, not an article.\n\n" +
  "Accuracy over quantity: if you are not certain a publication exists under " +
  "that exact domain, leave it out. A short list is fine; an invented one is " +
  "not.\n\n" +
  "Answer with one publication per line, as `Name | https://homepage`, and " +
  "nothing else: no numbering, no commentary, no markdown.";

// The angle changes from run to run. Asked the same way every day the model
// answers with the same canonical dozen — the first automatic run came back
// 24 suggestions, 24 of them already in the catalog. A different question
// reaches a different part of what it knows.
//
// One angle is missing on purpose. "Small, obscure, one-person blogs" reads
// like the ideal brief and is the one that fails: it sends the model past the
// edge of what it knows and it fabricates the lot — The Walking Desk Gazette,
// The Quiet Anthropologist, The AI Whisperer, fifteen for fifteen invented.
// Verification catches them, but a run that adds nothing is a wasted run.
const BRIEFS: string[] = [
  `Suggest up to ${MAX_SUGGESTIONS_PER_RUN} others in the same vein.`,

  // Anchored on the publications, never on a single article's subject. Asked
  // the other way round — "publications the writer of that piece would read" —
  // the model follows the topic instead of the register, and answers a saved
  // piece about birdwatching with BirdWatching, Field & Stream and Outdoor
  // Life. All three have real feeds; all three sailed through verification.
  "Look at the publications the reader already has. Name others that belong " +
    "on the same shelf: same seriousness, same kind of writer, same reason " +
    "someone subscribes. Not more of the same subjects — more of the same " +
    "standard.",

  "Suggest publications from outside the United States — British, European, " +
    "Latin American, African, Asian and Australian magazines, newsletters " +
    "and blogs writing in English about the same concerns.",

  "The reader has the well-known titles already. Name publications that are " +
    "genuinely established — years of archives, a masthead you can picture — " +
    "but that a reader of the list above would not have met yet.",
];

// A window over what they saved, moved along each run. Rotating the evidence
// matters as much as rotating the question: a different handful of articles
// puts the model in a different neighbourhood before it is asked anything.
function tasteSample(userId: number, offset: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT e.title FROM user_events e
       WHERE e.user_id = ? AND e.title IS NOT NULL AND e.title != ''
         AND e.action IN ('save','like')
       ORDER BY e.id DESC`
    )
    .all(userId) as Array<{ title: string }>;
  const titles = rows.map((row) => row.title);
  if (titles.length <= TASTE_WINDOW) return titles;
  // Wraps, so the window keeps moving instead of stopping at the oldest save.
  const from = (offset * TASTE_WINDOW) % titles.length;
  return [...titles, ...titles].slice(from, from + TASTE_WINDOW);
}

function knownPublications(): string[] {
  return (
    getDb().prepare("SELECT title FROM feeds ORDER BY id").all() as Array<{
      title: string;
    }>
  ).map((row) => row.title);
}

// Bookkeeping in the settings table, read and written directly: these are the
// replenisher's notes to itself, and putting them through the typed settings
// helper would put them in the settings dialog too.
function readNote(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeNote(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

// Domains that have already failed to resolve to a feed. The model names the
// same non-existent sites run after run, and each one costs a page fetch and
// a handful of well-known-path probes to disprove again.
function deadHosts(): Set<string> {
  return new Set((readNote(DEAD_HOSTS_KEY) ?? "").split(",").filter(Boolean));
}

function rememberDead(results: CatalogAddition[]): void {
  const hosts = deadHosts();
  for (const entry of results) {
    if (entry.status !== "unreachable") continue;
    const host = normalizeHost(entry.url);
    if (host) hosts.add(host);
  }
  // Newest last, oldest dropped: a site that has been quiet for months gets
  // another chance eventually rather than being blacklisted for good.
  writeNote(DEAD_HOSTS_KEY, [...hosts].slice(-DEAD_HOSTS_MEMORY).join(","));
}

function dismissedHosts(): Set<string> {
  return new Set(
    (readNote(DISMISSED_HOSTS_KEY) ?? "").split(",").filter(Boolean)
  );
}

// Remove a catalog publication and remember the refusal. Returns false when
// the feed is a subscription — those are unsubscribed, never dismissed.
export function dismissPublication(feedId: number): boolean {
  const db = getDb();
  const feed = db
    .prepare("SELECT url, site_url, subscribed FROM feeds WHERE id = ?")
    .get(feedId) as
    | { url: string; site_url: string | null; subscribed: number }
    | undefined;
  if (!feed || feed.subscribed === 1) return false;

  const hosts = dismissedHosts();
  for (const value of [feed.url, feed.site_url]) {
    const host = value ? normalizeHost(value) : null;
    if (host) hosts.add(host);
  }
  writeNote(DISMISSED_HOSTS_KEY, [...hosts].slice(-DISMISSED_MEMORY).join(","));
  db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  return true;
}

export interface SuggestOptions {
  // Which angle to ask from; defaults to the next one in the rotation.
  brief?: number;
  // Ask about domains that failed before. Off for automatic runs, on when a
  // person pressed the button — a host that was unreachable last Tuesday may
  // simply have been down.
  retryDead?: boolean;
}

// Ask the model for publications like the ones this reader keeps, then let
// discoverFeedUrl be the judge. The model is a source of names, not of truth.
export async function suggestCatalog(
  userId: number,
  options: SuggestOptions = {}
): Promise<CatalogAddition[]> {
  if (!llmConfigured()) return [];
  const runs = Number(readNote(RUN_COUNT_KEY) ?? 0);
  const index = options.brief ?? runs;
  const taste = tasteSample(userId, index);
  if (taste.length === 0) return [];
  writeNote(RUN_COUNT_KEY, String(runs + 1));

  const brief = BRIEFS[index % BRIEFS.length];
  const known = knownPublications();
  const result = await complete(
    SUGGEST_SYSTEM,
    `Articles this reader saved:\n${taste.map((t) => `- ${t}`).join("\n")}\n\n` +
      `Publications they already have (do not suggest these):\n${known.join(", ")}\n\n` +
      brief,
    // Generous on purpose: a reasoning model spends part of the budget
    // thinking, and twenty-five lines of output after that does not fit in the
    // few hundred tokens a blurb needs. Too small a budget here comes back
    // empty rather than truncated.
    1500,
    // The annotation model, not the smaller ranking one. Naming real
    // publications is knowledge work, and the small model does it badly: it
    // loops, and it gets domains subtly wrong (the-marginalian.org for
    // themarginalian.org, noema.org for noemamag.com) — which verification
    // then rejects, so a whole run comes back empty.
    llmProviders()
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

  const results = await addAll(
    candidates,
    options.retryDead ? new Set() : deadHosts()
  );
  rememberDead(results);
  // Warm up first: the vetting reads the headlines a publication actually
  // runs, which is the only evidence worth judging it on.
  await warmUp(results);
  await vetAdditions(results, taste);
  report(`suggest (${index % BRIEFS.length})`, results);
  return results;
}

const VET_SYSTEM =
  "You are checking a discovery list for one reader. For each numbered " +
  "publication you are given its three most recent headlines — judge from " +
  "those, not from the name.\n\n" +
  "A publication belongs if someone who saved the articles listed would be " +
  "glad to meet it. It does not belong if it is a trade or hobby title, an " +
  "SEO content farm, a press-release wire, a general daily newspaper, or a " +
  "section of a larger site rather than a publication in its own right.\n\n" +
  "Answer with the numbers that do NOT belong, comma-separated, and nothing " +
  "else. Answer `none` if they all do. Do not explain.";

// The last gate, and the only one a machine can't do alone. Verification
// proves a feed exists; nothing so far asks whether it should be here — and
// the model, left to free-associate, will answer an article about birdwatching
// with BirdWatching, Field & Stream and Outdoor Life, all three of which have
// real feeds and sail through.
//
// Embeddings cannot do this job. Measured across the catalog, taste-fit puts
// Outdoor Life (0.646) between Defector (0.653) and Citation Needed (0.648),
// and BirdWatching a thousandth above The New Yorker: any floor that cut the
// hobby titles would take half the good ones with it. Judging headlines is
// exactly the work the model is better at than the vector.
//
// It only ever removes what this run just added, and only on a clear answer —
// an unparseable or failed reply keeps everything. Being wrong here costs a
// publication the reader might have liked, so the doubt runs that way.
async function vetAdditions(
  additions: CatalogAddition[],
  taste: string[]
): Promise<void> {
  const added = additions.filter((entry) => entry.status === "added");
  if (added.length === 0) return;

  const db = getDb();
  const shown = added.map((entry) => {
    const feed = db
      .prepare("SELECT id, title FROM feeds WHERE url = ?")
      .get(entry.feedUrl!) as { id: number; title: string } | undefined;
    const headlines = feed
      ? (db
          .prepare(
            "SELECT title FROM articles WHERE feed_id = ? ORDER BY published_at DESC LIMIT 3"
          )
          .all(feed.id) as Array<{ title: string }>).map((row) => row.title)
      : [];
    return { entry, feed, headlines };
  });

  const listing = shown
    .map(
      ({ entry, feed, headlines }, index) =>
        `${index + 1}. ${feed?.title ?? entry.name}\n` +
        (headlines.length > 0
          ? headlines.map((line) => `   - ${line}`).join("\n")
          : "   (no articles yet)")
    )
    .join("\n");

  const result = await complete(
    VET_SYSTEM,
    `Articles this reader saved:\n${taste.map((t) => `- ${t}`).join("\n")}\n\n` +
      `Publications to check:\n${listing}`,
    400,
    llmProviders()
  );
  if (!result) return;

  const answer = result.text.trim();
  if (/^none\b/i.test(answer)) return;
  const numbers = new Set(
    (answer.match(/\d+/g) ?? []).map((value) => Number(value))
  );
  if (numbers.size === 0 || numbers.size === shown.length) return;

  for (const [index, { entry, feed }] of shown.entries()) {
    if (!numbers.has(index + 1) || !feed) continue;
    db.prepare("DELETE FROM feeds WHERE id = ?").run(feed.id);
    entry.status = "mismatch";
  }
}

let running = false;

// Called from the 10-minute tick. The catalog is meant to keep filling itself,
// so once a day it asks for more — but only up to a ceiling, because every
// catalog publication is a feed to refresh forever after, and a reader can
// only meet so many at once.
export async function maybeSuggestCatalog(): Promise<void> {
  if (running || !llmConfigured()) return;
  if ((process.env.CATALOG_AUTOFILL ?? "on") === "off") return;

  const last = readNote(LAST_RUN_KEY);
  if (last && Date.now() - Date.parse(last) < SUGGEST_EVERY_MS) return;
  // Stamped before the run, not after: a run that throws should wait for
  // tomorrow like any other, not retry on every tick for a day.
  writeNote(LAST_RUN_KEY, new Date().toISOString());

  const size = catalogSize();
  if (size >= CATALOG_CEILING) {
    console.log(`[catalog] full — ${size} publications, ceiling ${CATALOG_CEILING}`);
    return;
  }

  const users = getDb().prepare("SELECT id FROM users ORDER BY id").all() as
    Array<{ id: number }>;
  if (users.length === 0) return;
  // One call a day whoever is reading: taking turns keeps the cost flat as
  // accounts are added, and the catalog is shared between them anyway.
  const runs = Number(readNote(RUN_COUNT_KEY) ?? 0);
  const user = users[runs % users.length];

  running = true;
  try {
    await suggestCatalog(user.id);
  } catch (error) {
    console.error("[catalog] suggestion run failed:", error);
  } finally {
    running = false;
  }
}

function report(source: string, results: CatalogAddition[]): void {
  const counts = results.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[catalog] ${source}: ${counts.added ?? 0} added, ` +
      `${counts.duplicate ?? 0} already known, ` +
      `${counts.unreachable ?? 0} had no usable feed, ` +
      `${counts.mismatch ?? 0} did not belong`
  );
  for (const entry of results.filter((r) => r.status === "mismatch")) {
    console.log(`[catalog]   dropped as off-key: ${entry.name} (${entry.url})`);
  }
  // Name the rejects rather than swallowing them: a suggestion that never
  // resolves is the signal that a source has moved or was invented.
  for (const entry of results.filter((r) => r.status === "unreachable")) {
    console.log(`[catalog]   no feed: ${entry.name} (${entry.url})`);
  }
}
