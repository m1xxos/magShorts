import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { discoverFeedUrl, parseFeedMeta, refreshStaleFeeds } from "@/lib/rss";
import { currentCity } from "@/lib/settings";

export const dynamic = "force-dynamic";

// The publications feeding the city digest, and the door for adding one by
// hand.
//
// That door is not a convenience. Finding local publications needs a language
// model, and there is no non-model route to "name the papers of this city" —
// so without a way to paste a URL, a reader with no LLM configured, or one
// whose town the model has never heard of, has a feature that can never do
// anything at all.

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const city = currentCity();
  if (!city) return NextResponse.json({ city: "", sources: [] });

  const sources = getDb()
    .prepare(
      `SELECT f.id, f.title, f.url, f.site_url, f.enabled, f.failures,
              f.last_fetched_at,
              (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id) AS article_count
         FROM feeds f
        WHERE f.city = ?
        ORDER BY f.title COLLATE NOCASE`
    )
    .all(city);
  return NextResponse.json({ city, sources });
}

export async function POST(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const city = currentCity();
  if (!city) {
    return NextResponse.json(
      { error: "Name your city in Settings first" },
      { status: 400 }
    );
  }

  let url = "";
  try {
    const body = await request.json();
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json(
      { error: "Please enter a valid http(s) URL" },
      { status: 400 }
    );
  }

  // A feed URL or a plain site address, the same as Add publication.
  const feedUrl = await discoverFeedUrl(url);
  if (!feedUrl) {
    return NextResponse.json(
      { error: "Could not find an RSS/Atom feed at this URL" },
      { status: 422 }
    );
  }

  const db = getDb();
  // feeds.url is UNIQUE, and the answer differs by what the row already is:
  // a publication you subscribe to cannot also be a city source, and saying
  // so is more use than "already exists".
  const existing = db
    .prepare("SELECT id, city, subscribed FROM feeds WHERE url IN (?, ?)")
    .get(url, feedUrl) as
    | { id: number; city: string | null; subscribed: number }
    | undefined;
  if (existing?.city === city) {
    return NextResponse.json(
      { error: "Already one of your local publications" },
      { status: 409 }
    );
  }
  if (existing) {
    return NextResponse.json(
      {
        error: existing.subscribed
          ? "You already subscribe to this publication, so it is in your feed rather than the city digest"
          : "This publication is already in the app",
      },
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

  // subscribed = 0 is what hides it from every other surface; the city is what
  // separates it from the Discover catalogue.
  const result = db
    .prepare(
      "INSERT INTO feeds (title, url, site_url, subscribed, city) VALUES (?, ?, ?, 0, ?)"
    )
    .run(meta.title, feedUrl, meta.site_url, city);
  const feedId = Number(result.lastInsertRowid);
  await refreshStaleFeeds(feedId);

  return NextResponse.json(
    db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId),
    { status: 201 }
  );
}
