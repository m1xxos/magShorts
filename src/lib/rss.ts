import Parser from "rss-parser";
import { getDb, type Feed } from "./db";

const STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_ITEMS_PER_FEED = 60;

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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
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

export async function parseFeedMeta(url: string) {
  const parsed = await parser.parseURL(url);
  return {
    title: parsed.title?.trim() || new URL(url).hostname,
    site_url: parsed.link ?? null,
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
          title,
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
      : db.prepare("SELECT * FROM feeds").all()
  ) as Feed[];

  const now = Date.now();
  const stale = feeds.filter((feed) => {
    if (!feed.last_fetched_at) return true;
    return now - new Date(feed.last_fetched_at + "Z").getTime() > STALE_AFTER_MS;
  });

  // Refresh in parallel; a failing feed should not block the others.
  await Promise.allSettled(stale.map((feed) => refreshFeedArticles(feed)));
}
