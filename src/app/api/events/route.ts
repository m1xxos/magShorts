import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// "view" is a pure impression: it never shapes the taste profile (no weight
// in recommend.ts), it only marks the link as seen so Shorts never repeats.
//
// "read" is weightless for the same reason and carries the only fact nothing
// else in the app records: how many seconds the reader was actually open. It
// says nothing about whether the article was liked — "dwell" already says that
// — so giving it a weight would count one reading twice.
const ACTIONS = new Set([
  "like",
  "dislike",
  "skip",
  "open",
  "save",
  "dwell",
  "view",
  "read",
]);

// Four hours. Longer than any article and shorter than a laptop lid left down,
// which is the failure this guards against.
const MAX_SECONDS = 4 * 3600;

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

  // Out-of-range or nonsense durations are dropped rather than clamped: a
  // stored NULL means "not measured", which the estimate knows how to fill in,
  // while a clamped 14400 would be a lie with a number on it.
  const raw = typeof body.seconds === "number" ? Math.round(body.seconds) : 0;
  const seconds = raw > 0 && raw <= MAX_SECONDS ? raw : null;

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
    `INSERT INTO user_events (user_id, article_id, link, title, feed_id, action, embedding, seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user.id,
    article?.id ?? null,
    link,
    article?.title ?? (typeof body.title === "string" ? body.title : null),
    article?.feed_id ?? null,
    action,
    article?.embedding ?? null,
    seconds
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}
