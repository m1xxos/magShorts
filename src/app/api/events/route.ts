import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["like", "dislike", "skip", "open", "save", "dwell"]);

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
  const action = typeof body.action === "string" ? body.action : "";
  if (!/^https?:\/\//.test(link) || !ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "link and a valid action are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  // Snapshot the article (incl. its embedding) so taste history survives
  // unsubscribing from the feed.
  const article = db
    .prepare(
      "SELECT id, title, feed_id, embedding FROM articles WHERE link = ?"
    )
    .get(link) as
    | { id: number; title: string; feed_id: number; embedding: Buffer | null }
    | undefined;

  db.prepare(
    `INSERT INTO user_events (user_id, article_id, link, title, feed_id, action, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user.id,
    article?.id ?? null,
    link,
    article?.title ?? (typeof body.title === "string" ? body.title : null),
    article?.feed_id ?? null,
    action,
    article?.embedding ?? null
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
