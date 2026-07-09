import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseFeedMeta, refreshStaleFeeds } from "@/lib/rss";

export const dynamic = "force-dynamic";

export async function GET() {
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
  let url: string;
  try {
    const body = await request.json();
    url = String(body.url ?? "").trim();
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
  const existing = db.prepare("SELECT id FROM feeds WHERE url = ?").get(url);
  if (existing) {
    return NextResponse.json(
      { error: "This feed is already in your subscriptions" },
      { status: 409 }
    );
  }

  let meta;
  try {
    meta = await parseFeedMeta(url);
  } catch {
    return NextResponse.json(
      { error: "Could not read an RSS/Atom feed at this URL" },
      { status: 422 }
    );
  }

  const result = db
    .prepare("INSERT INTO feeds (title, url, site_url) VALUES (?, ?, ?)")
    .run(meta.title, url, meta.site_url);
  const feedId = Number(result.lastInsertRowid);

  await refreshStaleFeeds(feedId);

  const feed = db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId);
  return NextResponse.json(feed, { status: 201 });
}
