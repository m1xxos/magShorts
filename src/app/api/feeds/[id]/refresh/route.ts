import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { refreshStaleFeeds } from "@/lib/rss";

export const dynamic = "force-dynamic";

// Fetch one feed now, whatever the staleness gate thinks.
//
// Manage sources calls this from the Retry button on a feed that is not
// answering. Everywhere else refreshes are opportunistic and gated to a
// quarter of an hour, which is right for a page render and wrong for a person
// who has just noticed a publication has gone quiet and wants to know whether
// it is back.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const feedId = Number(id);
  if (!Number.isInteger(feedId)) {
    return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
  }

  const db = getDb();
  const exists = db
    .prepare("SELECT id FROM feeds WHERE id = ?")
    .get(feedId) as { id: number } | undefined;
  if (!exists) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }

  await refreshStaleFeeds(feedId, { force: true });

  // The row as it stands after the attempt, with the same article_count shape
  // GET /api/feeds returns, so the caller can update one row instead of
  // reloading the whole page. failures and last_fetched_at are the two fields
  // that just changed, and they are what the row renders.
  const feed = db
    .prepare(
      `SELECT f.*, COUNT(a.id) AS article_count
         FROM feeds f
         LEFT JOIN articles a ON a.feed_id = f.id
        WHERE f.id = ?
        GROUP BY f.id`
    )
    .get(feedId);
  return NextResponse.json(feed);
}
