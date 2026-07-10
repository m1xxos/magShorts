import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = getDb()
    .prepare("SELECT * FROM reading_list ORDER BY added_at DESC, id DESC")
    .all();
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
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
    `INSERT INTO reading_list (link, title, summary, image_url, feed_title, published_at)
     VALUES (@link, @title, @summary, @image_url, @feed_title, @published_at)
     ON CONFLICT(link) DO UPDATE SET added_at = datetime('now')`
  ).run({
    link,
    title,
    summary: typeof body.summary === "string" ? body.summary : null,
    image_url: typeof body.image_url === "string" ? body.image_url : null,
    feed_title: typeof body.feed_title === "string" ? body.feed_title : null,
    published_at:
      typeof body.published_at === "string" ? body.published_at : null,
  });

  const item = db
    .prepare("SELECT * FROM reading_list WHERE link = ?")
    .get(link);
  return NextResponse.json(item, { status: 201 });
}
