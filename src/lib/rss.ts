import Parser from "rss-parser";
import { getDb, type Feed } from "./db";

const STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_ITEMS_PER_FEED = 200;

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
const DISCOVERY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 magShorts/1.0";

// Cheap check that a URL serves an RSS/Atom document — a short-timeout fetch
// and a content sniff, so probing a dozen well-known paths stays fast.
async function sniffFeed(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DISCOVERY_UA,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return false;
    const head = (await response.text()).slice(0, 4000).trimStart();
    return (
      /<(rss|feed|rdf:RDF)[\s>]/i.test(head) ||
      (head.startsWith("<?xml") && /<(rss|feed|rdf)/i.test(head))
    );
  } catch {
    return false;
  }
}

// Given any page URL (a site home, a blog page or the feed itself), find a
// working RSS/Atom feed: try the URL as-is, then <link rel="alternate">
// tags in its HTML, then the usual well-known paths.
export async function discoverFeedUrl(url: string): Promise<string | null> {
  try {
    await parser.parseURL(url);
    return url;
  } catch {
    // Not a feed — inspect the page.
  }

  let html = "";
  let finalUrl = url;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DISCOVERY_UA,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    finalUrl = response.url;
    html = (await response.text()).slice(0, 500_000);
  } catch {
    return null;
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
  for (const path of COMMON_FEED_PATHS) {
    candidates.push(base + path);
    if (origin !== base) candidates.push(origin + path);
  }

  for (const candidate of [...new Set(candidates)].slice(0, 24)) {
    if (await sniffFeed(candidate)) return candidate;
  }
  return null;
}

export async function parseFeedMeta(url: string) {
  const parsed = await parser.parseURL(url);
  return {
    title: stripHtml(parsed.title ?? "") || new URL(url).hostname,
    site_url: parsed.link?.trim() || new URL(url).origin,
  };
}

export function refreshFeedArticles(feed: Feed): Promise<void> {
  return parser.parseURL(feed.url).then((parsed) => {
    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO articles (feed_id, guid, title, link, summary, image_url, published_at)
      VALUES (@feed_id, @guid, @title, @link, @summary, @image_url, @published_at)
      ON CONFLICT(feed_id, guid) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        image_url = COALESCE(excluded.image_url, articles.image_url)
    `);

    const items = (parsed.items ?? []).slice(0, MAX_ITEMS_PER_FEED);
    const insertAll = db.transaction(() => {
      for (const item of items) {
        const link = item.link?.trim();
        const title = item.title?.trim();
        if (!link || !title) continue;
        const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
        upsert.run({
          feed_id: feed.id,
          guid: item.guid ?? link,
          // Some feeds (The Atlantic) put markup like <em> inside titles.
          title: stripHtml(title),
          link,
          summary: extractSummary(item),
          image_url: extractImage(item),
          published_at: publishedAt,
        });
      }
      db.prepare("UPDATE feeds SET last_fetched_at = datetime('now') WHERE id = ?").run(feed.id);
    });
    insertAll();
  });
}

export async function refreshStaleFeeds(feedId?: number): Promise<void> {
  const db = getDb();
  const feeds = (
    feedId
      ? db.prepare("SELECT * FROM feeds WHERE id = ?").all(feedId)
      : db.prepare("SELECT * FROM feeds WHERE enabled = 1").all()
  ) as Feed[];

  const now = Date.now();
  const stale = feeds.filter((feed) => {
    if (!feed.last_fetched_at) return true;
    return now - new Date(feed.last_fetched_at + "Z").getTime() > STALE_AFTER_MS;
  });

  // Refresh in parallel; a failing feed should not block the others.
  await Promise.allSettled(stale.map((feed) => refreshFeedArticles(feed)));

  // Drain the embedding backlog in the background; never blocks the request.
  void import("./embeddings").then(({ backfillEmbeddings }) =>
    backfillEmbeddings()
  );
}
