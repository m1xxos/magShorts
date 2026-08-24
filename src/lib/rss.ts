import Parser from "rss-parser";
import { getDb, type Feed } from "./db";
import { fetchTextMaybeProxied } from "./net";

const STALE_AFTER_MS = 15 * 60 * 1000;
const CATALOG_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
// Consecutive failures before a catalog publication is taken out of rotation.
const CATALOG_MAX_FAILURES = 10;
const MAX_ITEMS_PER_FEED = 200;

// A catalog publication only has to show three tiles and rank against the
// taste profile, so it keeps a shallow window instead of an archive. Read
// later stores snapshots by link and user_events keep their own copy of the
// link and embedding, so trimming loses nothing the user has touched.
const CATALOG_KEEP_ARTICLES = 10;

// The folder name rides along with the feed so an article whose categories are
// unusable can still fall back to it without a second query per item.
type FeedWithFolder = Feed & { folder_name: string | null };

type CustomItem = {
  "media:content"?: { $?: { url?: string } } | Array<{ $?: { url?: string } }>;
  "media:thumbnail"?: { $?: { url?: string } };
  "content:encoded"?: string;
};

const parser = new Parser<Record<string, unknown>, CustomItem>({
  timeout: 15000,
  headers: { "User-Agent": "magShorts/1.0 (RSS reader)" },
  customFields: {
    item: [
      ["media:content", "media:content", { keepArray: true }],
      ["media:thumbnail", "media:thumbnail"],
      ["content:encoded", "content:encoded"],
    ],
  },
});

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(
      /&([a-z]+);/gi,
      (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match
    );
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// An empty <guid isPermaLink="false"></guid> parses to an object rather than a
// string, and better-sqlite3 refuses to bind it — one such item in Undark's
// feed failed the whole insert transaction, so the publication silently stopped
// updating. The link is a perfectly good identity when the guid is unusable.
function itemGuid(item: Parser.Item): string | null {
  const raw: unknown = item.guid;
  if (typeof raw === "string") return raw.trim() || null;
  const nested = (raw as { _?: unknown } | null)?._;
  return typeof nested === "string" ? nested.trim() || null : null;
}

function extractImage(item: Parser.Item & CustomItem): string | null {
  if (item.enclosure?.url && item.enclosure.type?.startsWith("image")) {
    return item.enclosure.url;
  }
  const media = item["media:content"];
  const mediaList = Array.isArray(media) ? media : media ? [media] : [];
  for (const entry of mediaList) {
    if (entry?.$?.url) return entry.$.url;
  }
  if (item["media:thumbnail"]?.$?.url) return item["media:thumbnail"].$.url;

  const html = item["content:encoded"] ?? item.content ?? "";
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match && /^https?:\/\//.test(match[1])) return match[1];
  return null;
}

function extractSummary(item: Parser.Item & CustomItem): string | null {
  const raw =
    item.contentSnippet ?? item.summary ?? item.content ?? item["content:encoded"];
  if (!raw) return null;
  const text = stripHtml(String(raw));
  if (!text) return null;
  return text.length > 600 ? text.slice(0, 600).trimEnd() + "…" : text;
}

// The digest's annotations need more than the 600-char summary. Most feeds ship
// the whole article in content:encoded, so keep it (capped) and save the digest
// a page fetch; feeds that only publish a teaser store nothing here.
const CONTENT_MAX_LENGTH = 6000;

function extractContent(item: Parser.Item & CustomItem): string | null {
  const raw = item["content:encoded"] ?? item.content;
  if (!raw) return null;
  const text = stripHtml(String(raw));
  // Below this it is just the summary again, and a page fetch will do better.
  if (text.length < 400) return null;
  return text.slice(0, CONTENT_MAX_LENGTH);
}

// Some feeds publish item links as site-relative paths — Harper's does. Stored
// raw they are unusable: nothing can fetch them and the card opens nowhere.
// Resolve against the publication's own site, falling back to the feed URL's
// origin when the feed has no site_url.
function absoluteLink(
  link: string | undefined,
  feed: Pick<Feed, "url" | "site_url">
): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  try {
    return new URL(link, feed.site_url ?? feed.url).toString();
  } catch {
    return null;
  }
}

// Feed categories range from one clean word ("Security") to a dozen tags or a
// whole taxonomy path, so only short word-like ones become a topic; everything
// else falls back to the folder the feed lives in.
const TOPIC_MAX_LENGTH = 22;

function usableTopic(text: string, feedTitle: string): boolean {
  if (!text || text.length > TOPIC_MAX_LENGTH) return false;
  if (/[/,|>]|https?:/i.test(text)) return false;
  if (text.split(" ").length > 2) return false;
  return text.toLowerCase() !== feedTitle.toLowerCase();
}

// Capitalize plain lowercase words but leave anything already cased alone, so
// "apps" reads as "Apps" while "iOS" and "AI" survive intact.
function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word) =>
      word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
}

function extractTopic(
  item: Parser.Item & CustomItem,
  feed: FeedWithFolder
): string | null {
  for (const entry of item.categories ?? []) {
    const raw = typeof entry === "string" ? entry : (entry as { _?: string })?._;
    if (!raw) continue;
    // Plenty of feeds emit slugs rather than labels ("wifi-security"), so
    // separators become spaces before the word count is judged.
    const text = stripHtml(String(raw).replace(/[-_]+/g, " "));
    if (usableTopic(text, feed.title)) return titleCase(text);
  }
  return feed.folder_name;
}

const COMMON_FEED_PATHS = [
  "feed",
  "feed/",
  "rss",
  "rss/",
  "feed.xml",
  "rss.xml",
  "atom.xml",
  "index.xml",
  "feed.atom",
  "blog.rss",
];

// Some hosts reset connections on bot-looking user agents.
export const DISCOVERY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 magShorts/1.0";

const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";

// Every feed fetch goes through here rather than rss-parser's own transport:
// parseURL uses Node's http module directly, which cannot be pointed at a
// proxy, and some publications are only reachable through one.
async function fetchFeedText(
  url: string,
  timeoutMs = 15000
): Promise<string | null> {
  const result = await fetchTextMaybeProxied(url, {
    headers: { "User-Agent": DISCOVERY_UA, Accept: FEED_ACCEPT },
    redirect: "follow",
    timeoutMs,
  });
  return result?.text ?? null;
}

async function parseFeed(url: string): Promise<Parser.Output<CustomItem>> {
  const text = await fetchFeedText(url);
  if (text === null) throw new Error(`could not fetch ${url}`);
  return parser.parseString(text);
}

// Cheap check that a URL serves an RSS/Atom document — a short-timeout fetch
// and a content sniff, so probing a dozen well-known paths stays fast.
async function sniffFeed(url: string): Promise<boolean> {
  const text = await fetchFeedText(url, 6000);
  if (text === null) return false;
  const head = text.slice(0, 4000).trimStart();
  // WordPress answers <any-page>/feed/ with that page's *comments*, and it is
  // a perfectly valid RSS document — which is how "Comments on: Home" ended up
  // in the catalog standing in for Granta. The title is the giveaway.
  if (/<title>\s*Comments on:/i.test(head)) return false;
  return (
    /<(rss|feed|rdf:RDF)[\s>]/i.test(head) ||
    (head.startsWith("<?xml") && /<(rss|feed|rdf)/i.test(head))
  );
}

// Given any page URL (a site home, a blog page or the feed itself), find a
// working RSS/Atom feed: try the URL as-is, then <link rel="alternate">
// tags in its HTML, then the usual well-known paths.
export async function discoverFeedUrl(url: string): Promise<string | null> {
  try {
    await parseFeed(url);
    return url;
  } catch {
    // Not a feed — inspect the page.
  }

  // A failed page fetch is not the end: plenty of publications put the site
  // behind a bot wall while serving /feed to anyone who asks (Defector, Rest
  // of World, MIT Technology Review all behave this way). Losing the HTML only
  // costs us the <link rel="alternate"> hints, so fall through to the
  // well-known paths rather than giving up.
  let html = "";
  let finalUrl = url;
  try {
    const page = await fetchTextMaybeProxied(url, {
      headers: {
        "User-Agent": DISCOVERY_UA,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });
    if (page) {
      finalUrl = page.url;
      html = page.text.slice(0, 500_000);
    }
  } catch {
    // Same: keep the original URL and try the conventional paths under it.
  }

  const candidates: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/application\/(rss|atom)\+xml/i.test(tag)) continue;
    // href value may be quoted or bare (some static generators skip quotes).
    const href = tag.match(/href=(?:"([^"]+)"|'([^']+)'|([^\s>"']+))/i);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!value || /comment/i.test(value)) continue;
    try {
      candidates.push(new URL(value, finalUrl).toString());
    } catch {
      // Ignore malformed hrefs.
    }
  }

  const base = finalUrl.endsWith("/") ? finalUrl : finalUrl + "/";
  const origin = new URL(finalUrl).origin + "/";
  // Origin before base. A home page that redirects (granta.com → /home/) makes
  // the base a sub-path, and a feed under a sub-path is usually that page's
  // comments rather than the publication.
  for (const path of COMMON_FEED_PATHS) {
    candidates.push(origin + path);
    if (origin !== base) candidates.push(base + path);
  }

  for (const candidate of [...new Set(candidates)].slice(0, 24)) {
    if (await sniffFeed(candidate)) return candidate;
  }
  return null;
}

export async function parseFeedMeta(url: string) {
  const parsed = await parseFeed(url);
  return {
    title: stripHtml(parsed.title ?? "") || new URL(url).hostname,
    site_url: parsed.link?.trim() || new URL(url).origin,
  };
}

export function refreshFeedArticles(feed: FeedWithFolder): Promise<void> {
  return parseFeed(feed.url).then((parsed) => {
    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO articles (feed_id, guid, title, link, summary, image_url, published_at, topic, content)
      VALUES (@feed_id, @guid, @title, @link, @summary, @image_url, @published_at, @topic, @content)
      ON CONFLICT(feed_id, guid) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        image_url = COALESCE(excluded.image_url, articles.image_url),
        topic = COALESCE(excluded.topic, articles.topic),
        content = COALESCE(excluded.content, articles.content)
    `);

    // The identity of an article is its link, not its guid. Publishers change
    // guid schemes — The Atlantic moved from RSS to Atom and every one of its
    // articles arrived wearing a new id — and a reader that trusts the guid
    // stores the whole feed twice when that happens. Reusing the guid already
    // on file for this link makes the upsert land on the existing row instead,
    // and keeps its embedding, its topic and anything pointing at it.
    const knownGuid = db.prepare(
      "SELECT guid FROM articles WHERE feed_id = ? AND link = ?"
    );

    const items = (parsed.items ?? []).slice(0, MAX_ITEMS_PER_FEED);
    const insertAll = db.transaction(() => {
      for (const item of items) {
        const link = absoluteLink(item.link?.trim(), feed);
        const title = item.title?.trim();
        if (!link || !title) continue;
        const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
        const known = knownGuid.get(feed.id, link) as
          | { guid: string }
          | undefined;
        upsert.run({
          feed_id: feed.id,
          guid: known?.guid ?? itemGuid(item) ?? link,
          // Some feeds (The Atlantic) put markup like <em> inside titles.
          title: stripHtml(title),
          link,
          summary: extractSummary(item),
          image_url: extractImage(item),
          published_at: publishedAt,
          topic: extractTopic(item, feed),
          content: extractContent(item),
        });
      }
      db.prepare("UPDATE feeds SET last_fetched_at = datetime('now') WHERE id = ?").run(feed.id);
      if (!feed.subscribed) trimCatalogFeed(db, feed.id);
    });
    insertAll();
  });
}

// Keep only the newest articles of a catalog publication. Runs inside the
// upsert transaction so the feed is never briefly both full and trimmed.
function trimCatalogFeed(db: ReturnType<typeof getDb>, feedId: number): void {
  db.prepare(
    `DELETE FROM articles WHERE feed_id = ? AND id NOT IN (
       SELECT id FROM articles WHERE feed_id = ?
       ORDER BY published_at DESC, id DESC LIMIT ?
     )`
  ).run(feedId, feedId, CATALOG_KEEP_ARTICLES);
}

// Trim every catalog publication — used right after a batch of feeds moves
// into the catalog, where waiting for each one's next refresh would leave the
// database carrying an archive nobody can see.
export function trimAllCatalogFeeds(): number {
  const db = getDb();
  const before = db.prepare("SELECT COUNT(*) AS n FROM articles").get() as {
    n: number;
  };
  const feeds = db
    .prepare("SELECT id FROM feeds WHERE subscribed = 0")
    .all() as Array<{ id: number }>;
  const trim = db.transaction(() => {
    for (const feed of feeds) trimCatalogFeed(db, feed.id);
  });
  trim();
  const after = db.prepare("SELECT COUNT(*) AS n FROM articles").get() as {
    n: number;
  };
  return before.n - after.n;
}

// Concurrent callers (several requests landing right after the Mac wakes
// from sleep) share one full refresh instead of each fetching every feed.
let fullRefreshInFlight: Promise<void> | null = null;

// `force` skips the staleness gate for one feed. Needed because a feed that is
// failing keeps its old last_fetched_at and therefore always looks stale — but
// one that failed two minutes after a successful fetch does not, and a Retry
// button that silently does nothing is worse than no button.
export function refreshStaleFeeds(
  feedId?: number,
  options: { force?: boolean } = {}
): Promise<void> {
  if (feedId === undefined && fullRefreshInFlight) return fullRefreshInFlight;
  const refresh = doRefreshStaleFeeds(feedId, options.force ?? false);
  if (feedId === undefined) {
    fullRefreshInFlight = refresh.finally(() => {
      fullRefreshInFlight = null;
    });
    return fullRefreshInFlight;
  }
  return refresh;
}

async function doRefreshStaleFeeds(
  feedId?: number,
  force = false
): Promise<void> {
  const db = getDb();
  const select = `SELECT f.*, fo.name AS folder_name FROM feeds f
     LEFT JOIN folders fo ON fo.id = f.folder_id`;
  const feeds = (
    feedId
      ? db.prepare(`${select} WHERE f.id = ?`).all(feedId)
      : db.prepare(`${select} WHERE f.enabled = 1`).all()
  ) as FeedWithFolder[];

  const now = Date.now();
  const stale = force ? feeds : feeds.filter((feed) => {
    if (!feed.last_fetched_at) return true;
    // Catalog publications refresh far less often: nobody is reading them yet,
    // and there are more of them than there are subscriptions.
    const after = feed.subscribed ? STALE_AFTER_MS : CATALOG_STALE_AFTER_MS;
    return now - new Date(feed.last_fetched_at + "Z").getTime() > after;
  });

  // Refresh in parallel; a failing feed should not block the others.
  const results = await Promise.allSettled(
    stale.map((feed) => refreshFeedArticles(feed))
  );
  results.forEach((result, index) => {
    const feed = stale[index];
    if (result.status === "fulfilled") {
      if (feed.failures > 0) {
        db.prepare("UPDATE feeds SET failures = 0 WHERE id = ?").run(feed.id);
      }
      return;
    }
    // A failed feed keeps its old last_fetched_at and stays stale, so
    // make the failure visible instead of silently retrying forever.
    console.warn(
      `[rss] refresh failed for ${feed.title}:`,
      result.reason?.message ?? result.reason
    );
    const failures = feed.failures + 1;
    db.prepare("UPDATE feeds SET failures = ? WHERE id = ?").run(
      failures,
      feed.id
    );
    // Retire a catalog publication that has stopped answering. Only a catalog
    // one: a subscription is the reader's own choice and disabling it behind
    // their back would look like the app losing their feed, so those keep
    // failing loudly instead. At six hours between attempts this is two and a
    // half days of silence, long enough to outlast an outage.
    if (feed.subscribed === 0 && failures >= CATALOG_MAX_FAILURES) {
      db.prepare("UPDATE feeds SET enabled = 0 WHERE id = ?").run(feed.id);
      console.warn(
        `[rss] retired ${feed.title} from the catalog after ${failures} failed refreshes`
      );
    }
  });

  // Drain the embedding and page-cover backlogs in the background;
  // never blocks the request.
  void import("./embeddings").then(({ backfillEmbeddings }) =>
    backfillEmbeddings()
  );
  void import("./articleImages").then(({ backfillArticleImages }) =>
    backfillArticleImages()
  );
}
