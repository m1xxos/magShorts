import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = getDb()
    .prepare(
      "SELECT * FROM reading_list WHERE user_id = ? ORDER BY added_at DESC, id DESC"
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

  const item = db
    .prepare("SELECT * FROM reading_list WHERE user_id = ? AND link = ?")
    .get(user.id, link);
  return NextResponse.json(item, { status: 201 });
}
