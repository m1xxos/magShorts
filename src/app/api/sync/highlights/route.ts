import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// The reader's own columns, plus deleted_at: tombstones are the point here. A
// client that has already written a highlight into a note has to be told when
// it goes away, and a row that simply stops being returned is a note that
// lives forever.
//
// Deliberately absent: orphaned_at, end_offset and body_hash. Re-anchoring
// writes those and pointedly does not touch updated_at — it is bookkeeping,
// not an edit, and bumping the cursor for it would make every open of an
// article look like a change. The consequence is that this endpoint could
// never deliver a change to them, and a field that is published but can go
// quietly stale forever is worse than one that was never offered.
//
// start_offset stays, because it is how a client puts the passages in reading
// order, and there staleness is both harmless and self-correcting: the
// offsets only move when the article is re-extracted, and the order they give
// is still the order they were last seen in.
const COLUMNS = `h.id, h.link, h.article_title, h.feed_title, h.published_at,
   h.quote, h.prefix, h.suffix, h.start_offset,
   h.deleted_at, h.note, h.created_at, h.updated_at,
   (SELECT a.id FROM articles a WHERE a.link = h.link ORDER BY a.id LIMIT 1)
     AS article_id`;

interface Row {
  id: number;
  updated_at: string;
  deleted_at: string | null;
  [key: string]: unknown;
}

function toDto(row: Row) {
  const { deleted_at, ...rest } = row;
  return { ...rest, deleted: deleted_at !== null };
}

// "<updated_at>|<id>". Two parts because datetime('now') has one-second
// resolution: edit three highlights in the same second and a timestamp alone
// cannot say which of them a page ended on, so a client would either see one
// twice or miss one entirely.
function parseCursor(value: string | null): { at: string; id: number } {
  if (!value) return { at: "", id: 0 };
  const cut = value.lastIndexOf("|");
  if (cut < 0) return { at: value, id: 0 };
  const id = Number(value.slice(cut + 1));
  return { at: value.slice(0, cut), id: Number.isFinite(id) ? id : 0 };
}

export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  // Floor, because a fractional LIMIT reaches SQLite as a fractional LIMIT and
  // it answers with "datatype mismatch" — a 500 for what is really a typo.
  const limit = Math.min(
    Math.max(Math.floor(Number(params.get("limit"))) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const since = parseCursor(params.get("since"));

  // Keyset, not OFFSET: idx_highlights_user_updated is (user_id, updated_at,
  // id), so this is a range scan that starts where the last page stopped, and
  // it stays that way at any depth. Lexicographic order on
  // "YYYY-MM-DD HH:MM:SS" is chronological order, which is why no conversion
  // happens here.
  //
  // One extra row is asked for and thrown away: that is how the answer to
  // "is there more" is a fact rather than a guess.
  //
  // The current second is held back on purpose. The cursor is a point inside
  // an ordered stream, and a second that is still being written to is not yet
  // ordered: hand out "12:00:03|42" while 12:00:03 is in progress, and
  // anything written in that same second with a lower id — which is what a
  // burst of deletions from a newest-first list produces — fails both halves
  // of the test below and is never delivered again. That row is usually a
  // tombstone, so the cost of losing it is a note that lives forever in
  // somebody's vault, which is the exact thing deleted_at exists to prevent.
  const rows = getDb()
    .prepare(
      `SELECT ${COLUMNS}
         FROM highlights h
        WHERE h.user_id = ?
          AND h.updated_at < datetime('now')
          AND (h.updated_at > ? OR (h.updated_at = ? AND h.id > ?))
        ORDER BY h.updated_at ASC, h.id ASC
        LIMIT ?`
    )
    .all(user.id, since.at, since.at, since.id, limit + 1) as Row[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return NextResponse.json({
    items: page.map(toDto),
    // Unchanged when the page is empty, so a client that is up to date keeps
    // the cursor it already had rather than resetting itself to the beginning.
    next_since: last
      ? `${last.updated_at}|${last.id}`
      : (params.get("since") ?? ""),
    has_more: hasMore,
  });
}
