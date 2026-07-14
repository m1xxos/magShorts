import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const PRUNE_ABOVE_BYTES = 1024 * 1024 * 1024;
const PRUNE_TO_BYTES = 800 * 1024 * 1024;

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

function isPrivateHost(hostname: string): boolean {
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

export async function getCachedImage(url: string): Promise<CachedImage | null> {
  if (!isCacheableImageUrl(url)) return null;

  const failedAt = negativeCache.get(url);
  if (failedAt && Date.now() - failedAt < NEGATIVE_TTL_MS) return null;
  if (failedAt) negativeCache.delete(url);

  const dir = imageDir();
  const key = createHash("sha256").update(url).digest("hex");
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
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
      negativeCache.set(url, Date.now());
      return null;
    }

    fs.writeFileSync(bodyPath, buffer);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        contentType,
        sourceUrl: url,
        fetchedAt: new Date().toISOString(),
      })
    );
    if (Math.random() < 0.02) pruneImages(dir);
    return { buffer, contentType };
  } catch {
    negativeCache.set(url, Date.now());
    return null;
  }
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
