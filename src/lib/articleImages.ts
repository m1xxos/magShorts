import { getDb } from "./db";
import { isPrivateHost } from "./imageCache";
import { DISCOVERY_UA } from "./rss";

const CONCURRENCY = 4;
const PAGE_BYTE_LIMIT = 500_000;

// Pull the cover a page advertises for link previews: og:image first,
// then twitter:image, then the legacy <link rel="image_src">.
export function extractPageImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta\b[^>]*property=["']?og:image(?::url)?["']?[^>]*>/i,
    /<meta\b[^>]*name=["']?twitter:image(?::src)?["']?[^>]*>/i,
    /<link\b[^>]*rel=["']?image_src["']?[^>]*>/i,
  ];
  for (const pattern of patterns) {
    const tag = html.match(pattern)?.[0];
    if (!tag) continue;
    const attr = /<link/i.test(tag) ? "href" : "content";
    const value = tag.match(
      new RegExp(`${attr}=(?:"([^"]+)"|'([^']+)'|([^\\s>"']+))`, "i")
    );
    const raw = (value?.[1] ?? value?.[2] ?? value?.[3])?.trim();
    if (!raw) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (isPrivateHost(url.hostname)) continue;
      return url.toString();
    } catch {
      // Malformed URL in the tag — try the next pattern.
    }
  }
  return null;
}

async function fetchPageImage(link: string): Promise<string | null> {
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (isPrivateHost(parsed.hostname)) return null;
    const response = await fetch(link, {
      headers: {
        "User-Agent": DISCOVERY_UA,
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, PAGE_BYTE_LIMIT);
    return extractPageImage(html, response.url);
  } catch {
    return null;
  }
}

let running = false;

// Fill in covers RSS didn't provide by reading each article page's
// og:image. Articles that genuinely have none get image_url = '' — a
// "checked, nothing there" marker so they aren't fetched again (a later
// RSS update with a real image still overwrites it via the upsert's
// COALESCE).
export async function backfillArticleImages(limit = 120): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const db = getDb();
    const articles = db
      .prepare(
        `SELECT id, link FROM articles
         WHERE image_url IS NULL
         ORDER BY published_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: number; link: string }>;
    if (articles.length === 0) return 0;

    const update = db.prepare("UPDATE articles SET image_url = ? WHERE id = ?");
    let found = 0;
    const queue = [...articles];
    async function worker() {
      while (queue.length > 0) {
        const article = queue.shift()!;
        const image = await fetchPageImage(article.link);
        update.run(image ?? "", article.id);
        if (image) found++;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, articles.length) }, worker)
    );
    return found;
  } finally {
    running = false;
  }
}
