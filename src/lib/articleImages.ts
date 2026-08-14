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

type PageImageResult =
  | { kind: "found"; url: string }
  // The page loaded fine and simply advertises no image.
  | { kind: "none" }
  // Fetch problem (403/429/5xx/timeout) — the page may still have one.
  | { kind: "failed" };

// Fetch an article page as HTML. Shared with the digest, which reads the body
// text out of the same document rather than opening a second connection.
export async function fetchPageHtml(
  link: string
): Promise<{ html: string; url: string } | null> {
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
    return {
      html: (await response.text()).slice(0, PAGE_BYTE_LIMIT),
      url: response.url,
    };
  } catch {
    return null;
  }
}

// A link we will never be able to fetch (mailto:, an intranet host). Worth
// telling apart from a failed fetch: it deserves the permanent "nothing there"
// marker rather than a retry with backoff.
function unfetchable(link: string): boolean {
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    return isPrivateHost(parsed.hostname);
  } catch {
    return true;
  }
}

async function fetchPageImage(link: string): Promise<PageImageResult> {
  if (unfetchable(link)) return { kind: "none" };
  const page = await fetchPageHtml(link);
  if (!page) return { kind: "failed" };
  const url = extractPageImage(page.html, page.url);
  return url ? { kind: "found", url } : { kind: "none" };
}

// Links whose page fetch keeps failing (bot walls like nytimes.com, rate
// limits): back off instead of hammering them every tick. In-memory only —
// a restart grants everyone a fresh chance.
const failedLinks = new Map<string, { attempts: number; lastAt: number }>();
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;
const FAILURE_MAX_ATTEMPTS = 2;

function inBackoff(link: string): boolean {
  const failure = failedLinks.get(link);
  if (!failure) return false;
  if (Date.now() - failure.lastAt > FAILURE_BACKOFF_MS) return false;
  return failure.attempts >= FAILURE_MAX_ATTEMPTS;
}

let running = false;

// Fill in covers RSS didn't provide by reading each article page's
// og:image. Articles whose page genuinely advertises none get
// image_url = '' — a "checked, nothing there" marker so they aren't
// fetched again (a later RSS update with a real image still overwrites it
// via the upsert's COALESCE). Failed fetches stay NULL and are retried
// with a backoff.
export async function backfillArticleImages(limit = 120): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const db = getDb();
    const articles = (
      db
        .prepare(
          `SELECT id, link FROM articles
           WHERE image_url IS NULL
           ORDER BY published_at DESC LIMIT ?`
        )
        .all(limit) as Array<{ id: number; link: string }>
    ).filter((article) => !inBackoff(article.link));
    if (articles.length === 0) return 0;

    const update = db.prepare("UPDATE articles SET image_url = ? WHERE id = ?");
    let found = 0;
    const queue = [...articles];
    async function worker() {
      while (queue.length > 0) {
        const article = queue.shift()!;
        const result = await fetchPageImage(article.link);
        if (result.kind === "found") {
          update.run(result.url, article.id);
          failedLinks.delete(article.link);
          found++;
        } else if (result.kind === "none") {
          update.run("", article.id);
          failedLinks.delete(article.link);
        } else {
          const failure = failedLinks.get(article.link);
          const stale =
            failure && Date.now() - failure.lastAt > FAILURE_BACKOFF_MS;
          failedLinks.set(article.link, {
            attempts: stale ? 1 : (failure?.attempts ?? 0) + 1,
            lastAt: Date.now(),
          });
        }
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
