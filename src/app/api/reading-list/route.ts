import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { extractForLink } from "@/lib/extract";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The article row behind each saved link, when there still is one: the
  // in-app reader is keyed on an article id, and Read later stores snapshots
  // by link so its rows outlive the articles they came from. Correlated
  // subqueries rather than a join, so a link that two feeds both carry cannot
  // turn one saved item into two.
  const items = getDb()
    .prepare(
      `SELECT r.*,
         (SELECT a.id FROM articles a WHERE a.link = r.link ORDER BY a.id LIMIT 1)
           AS article_id,
         (SELECT a.feed_id FROM articles a WHERE a.link = r.link ORDER BY a.id LIMIT 1)
           AS feed_id
       FROM reading_list r
       WHERE r.user_id = ?
       ORDER BY r.added_at DESC, r.id DESC`
    )
    .all(user.id);
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const link = typeof body.link === "string" ? body.link.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!/^https?:\/\//.test(link) || !title) {
    return NextResponse.json(
      { error: "link and title are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO reading_list (user_id, link, title, summary, image_url, feed_title, published_at)
     VALUES (@user_id, @link, @title, @summary, @image_url, @feed_title, @published_at)
     ON CONFLICT(user_id, link) DO UPDATE SET added_at = datetime('now')`
  ).run({
    user_id: user.id,
    link,
    title,
    summary: typeof body.summary === "string" ? body.summary : null,
    image_url: typeof body.image_url === "string" ? body.image_url : null,
    feed_title: typeof body.feed_title === "string" ? body.feed_title : null,
    published_at:
      typeof body.published_at === "string" ? body.published_at : null,
  });

  // Saving is a positive taste signal for recommendations.
  const article = db
    .prepare(
      "SELECT id, title, feed_id, embedding FROM articles WHERE link = ?"
    )
    .get(link) as
    | { id: number; title: string; feed_id: number; embedding: Buffer | null }
    | undefined;
  db.prepare(
    `INSERT INTO user_events (user_id, article_id, link, title, feed_id, action, embedding)
     VALUES (?, ?, ?, ?, ?, 'save', ?)`
  ).run(
    user.id,
    article?.id ?? null,
    link,
    article?.title ?? title,
    article?.feed_id ?? null,
    article?.embedding ?? null
  );

  // The second of the reader's two extraction triggers. Saving an article is a
  // promise to read it later, so the text is fetched now and waiting when the
  // reader opens — but nothing here waits on it, so a save is still instant.
  extractForLink(link);

  const item = db
    .prepare("SELECT * FROM reading_list WHERE user_id = ? AND link = ?")
    .get(user.id, link);
  return NextResponse.json(item, { status: 201 });
}

// Remove by link rather than by row id. Everywhere a bookmark shows filled —
// the reader's pill, a Discover tile — what the UI has in hand is the article
// and its link; the reading_list row id is an implementation detail it would
// otherwise have to go and look up first.
export async function DELETE(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const link = request.nextUrl.searchParams.get("link") ?? "";
  if (!/^https?:\/\//.test(link)) {
    return NextResponse.json({ error: "link is required" }, { status: 400 });
  }

  const db = getDb();
  const result = db
    .prepare("DELETE FROM reading_list WHERE user_id = ? AND link = ?")
    .run(user.id, link);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not saved" }, { status: 404 });
  }
  // Un-saving is not a dislike — it is the retraction of a save. Dropping the
  // event keeps the taste profile honest instead of leaving a positive signal
  // behind for something the reader changed their mind about.
  db.prepare(
    "DELETE FROM user_events WHERE user_id = ? AND link = ? AND action = 'save'"
  ).run(user.id, link);
  return NextResponse.json({ ok: true });
}
