import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { discoverFeedUrl, parseFeedMeta, refreshStaleFeeds } from "@/lib/rss";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const feeds = db
    .prepare(
      `SELECT f.*, COUNT(a.id) AS article_count
       FROM feeds f LEFT JOIN articles a ON a.feed_id = f.id
       GROUP BY f.id ORDER BY f.created_at ASC`
    )
    .all();
  return NextResponse.json(feeds);
}

export async function POST(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let url: string;
  let folderId: number | null = null;
  try {
    const body = await request.json();
    url = String(body.url ?? "").trim();
    if (body.folder_id !== undefined && body.folder_id !== null) {
      folderId = Number(body.folder_id);
      if (!Number.isInteger(folderId)) {
        return NextResponse.json({ error: "Invalid folder_id" }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json(
      { error: "Please enter a valid http(s) URL" },
      { status: 400 }
    );
  }

  const db = getDb();
  if (folderId !== null) {
    const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(folderId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }

  // Accept either a feed URL or a plain site/blog URL: discovery finds the
  // actual RSS/Atom endpoint behind it.
  const feedUrl = await discoverFeedUrl(url);
  if (!feedUrl) {
    return NextResponse.json(
      { error: "Could not find an RSS/Atom feed at this URL" },
      { status: 422 }
    );
  }

  const existing = db
    .prepare("SELECT id FROM feeds WHERE url IN (?, ?)")
    .get(url, feedUrl);
  if (existing) {
    return NextResponse.json(
      { error: "This feed is already in your subscriptions" },
      { status: 409 }
    );
  }

  let meta;
  try {
    meta = await parseFeedMeta(feedUrl);
  } catch {
    return NextResponse.json(
      { error: "Could not read an RSS/Atom feed at this URL" },
      { status: 422 }
    );
  }

  const result = db
    .prepare(
      "INSERT INTO feeds (title, url, site_url, folder_id) VALUES (?, ?, ?, ?)"
    )
    .run(meta.title, feedUrl, meta.site_url, folderId);
  const feedId = Number(result.lastInsertRowid);

  await refreshStaleFeeds(feedId);

  const feed = db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId);
  return NextResponse.json(feed, { status: 201 });
}
