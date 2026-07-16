import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { getDb } from "./db";

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const PRUNE_ABOVE_BYTES = 1024 * 1024 * 1024;
const PRUNE_TO_BYTES = 800 * 1024 * 1024;
// Bump when the stored format changes so old entries can't be served.
const CACHE_VERSION = "v2";
const MAX_WIDTH = 1280;
const WEBP_QUALITY = 78;
// Formats sharp re-encodes; GIF (animation) and SVG pass through untouched.
const TRANSFORMABLE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/tiff",
]);

export interface CachedImage {
  buffer: Buffer;
  contentType: string;
}

// URLs that recently failed, so a broken cover doesn't hit the origin on
// every render.
const negativeCache = new Map<string, number>();

function imageDir(): string {
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const dir = path.join(dataDir, "images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (isIP(host)) {
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }
  }
  return false;
}

export function isCacheableImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return !isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

function cacheKey(url: string): string {
  return createHash("sha256").update(`${CACHE_VERSION}:${url}`).digest("hex");
}

export function isImageCached(url: string): boolean {
  return fs.existsSync(path.join(imageDir(), `${cacheKey(url)}.json`));
}

async function transformImage(
  buffer: Buffer,
  contentType: string
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!TRANSFORMABLE.has(contentType.split(";")[0].trim())) {
    return { buffer, contentType };
  }
  try {
    const sharp = (await import("sharp")).default;
    const webp = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { buffer: webp, contentType: "image/webp" };
  } catch {
    // Un-decodable image — keep the original bytes.
    return { buffer, contentType };
  }
}

export async function getCachedImage(url: string): Promise<CachedImage | null> {
  if (!isCacheableImageUrl(url)) return null;

  const failedAt = negativeCache.get(url);
  if (failedAt && Date.now() - failedAt < NEGATIVE_TTL_MS) return null;
  if (failedAt) negativeCache.delete(url);

  const dir = imageDir();
  const key = cacheKey(url);
  const bodyPath = path.join(dir, key);
  const metaPath = path.join(dir, `${key}.json`);

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      contentType: string;
    };
    return { buffer: fs.readFileSync(bodyPath), contentType: meta.contentType };
  } catch {
    // cache miss
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "magShorts/1.0 (image cache)" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      negativeCache.set(url, Date.now());
      return null;
    }
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.byteLength === 0 || raw.byteLength > MAX_BYTES) {
      negativeCache.set(url, Date.now());
      return null;
    }

    const stored = await transformImage(raw, contentType);
    fs.writeFileSync(bodyPath, stored.buffer);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        contentType: stored.contentType,
        sourceUrl: url,
        fetchedAt: new Date().toISOString(),
      })
    );
    if (Math.random() < 0.02) pruneImages(dir);
    return stored;
  } catch {
    negativeCache.set(url, Date.now());
    return null;
  }
}

// Warm the cache for recent covers so first paint never waits on origin CDNs.
export async function prefetchImages(limit = 200): Promise<number> {
  const urls = (
    getDb()
      .prepare(
        `SELECT DISTINCT image_url FROM articles
         WHERE image_url IS NOT NULL
           AND image_url != ''
           AND published_at >= datetime('now', '-7 days')
         ORDER BY published_at DESC LIMIT ?`
      )
      .all(limit) as Array<{ image_url: string }>
  )
    .map((row) => row.image_url)
    .filter((url) => isCacheableImageUrl(url) && !isImageCached(url));

  let fetched = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const results = await Promise.all(
      urls.slice(i, i + CONCURRENCY).map((url) => getCachedImage(url))
    );
    fetched += results.filter(Boolean).length;
  }
  return fetched;
}

// Drop oldest files when the cache outgrows its budget.
function pruneImages(dir: string): void {
  try {
    const entries = fs
      .readdirSync(dir)
      .filter((name) => !name.endsWith(".json"))
      .map((name) => {
        const stats = fs.statSync(path.join(dir, name));
        return { name, size: stats.size, mtimeMs: stats.mtimeMs };
      });
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= PRUNE_ABOVE_BYTES) return;

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of entries) {
      if (total <= PRUNE_TO_BYTES) break;
      fs.rmSync(path.join(dir, entry.name), { force: true });
      fs.rmSync(path.join(dir, `${entry.name}.json`), { force: true });
      total -= entry.size;
    }
  } catch (error) {
    console.error("[imageCache] prune failed:", error);
  }
}
