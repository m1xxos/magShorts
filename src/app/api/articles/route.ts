import { NextRequest, NextResponse } from "next/server";
import { getDb, type Article } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { refreshStaleFeeds } from "@/lib/rss";

export const dynamic = "force-dynamic";

// Round-robin across feeds by recency so one prolific feed doesn't dominate.
function interleaveByFeed(articles: Article[]): Article[] {
  const byFeed = new Map<number, Article[]>();
  for (const article of articles) {
    const bucket = byFeed.get(article.feed_id) ?? [];
    bucket.push(article);
    byFeed.set(article.feed_id, bucket);
  }
  const buckets = [...byFeed.values()];
  const result: Article[] = [];
  for (let i = 0; result.length < articles.length; i++) {
    for (const bucket of buckets) {
      if (i < bucket.length) result.push(bucket[i]);
    }
  }
  return result;
}

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const searchParams = request.nextUrl.searchParams;
  const feedId = searchParams.get("feed") ? Number(searchParams.get("feed")) : undefined;
  const folderId = searchParams.get("folder") ? Number(searchParams.get("folder")) : undefined;
  const limit = Math.min(Number(searchParams.get("limit") ?? 80), 200);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);
  const mix = searchParams.get("mix") === "1";

  await refreshStaleFeeds(feedId);

  const db = getDb();
  const rows = (
    feedId
      ? db.prepare(
          `SELECT a.*, f.title AS feed_title FROM articles a
           JOIN feeds f ON f.id = a.feed_id
           WHERE a.feed_id = ?
           ORDER BY a.published_at DESC LIMIT ? OFFSET ?`
        ).all(feedId, limit, offset)
      : folderId
        ? // Explicitly selected folder: show it even when it's hidden from
          // the main feed (include_in_main = 0).
          db.prepare(
            `SELECT a.*, f.title AS feed_title FROM articles a
             JOIN feeds f ON f.id = a.feed_id
             WHERE f.enabled = 1 AND f.folder_id = ?
             ORDER BY a.published_at DESC LIMIT ? OFFSET ?`
          ).all(folderId, limit, offset)
        : // All publications is genuinely all enabled feeds; folder
          // visibility toggles only shape the For you recommendations.
          db.prepare(
            `SELECT a.*, f.title AS feed_title FROM articles a
             JOIN feeds f ON f.id = a.feed_id
             WHERE f.enabled = 1
             ORDER BY a.published_at DESC LIMIT ? OFFSET ?`
          ).all(limit, offset)
  ) as Article[];

  return NextResponse.json(mix ? interleaveByFeed(rows) : rows);
}
