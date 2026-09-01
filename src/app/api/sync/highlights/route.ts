import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// Same columns the reader's own highlights route selects, plus deleted_at:
// tombstones are the point here. A client that has already written a highlight
// into a note has to be told when it goes away, and a row that simply stops
// being returned is a note that lives forever.
const COLUMNS = `h.id, h.link, h.article_title, h.feed_title, h.published_at,
   h.quote, h.prefix, h.suffix, h.start_offset, h.end_offset, h.body_hash,
   h.orphaned_at, h.deleted_at, h.note, h.created_at, h.updated_at,
   (SELECT a.id FROM articles a WHERE a.link = h.link ORDER BY a.id LIMIT 1)
     AS article_id`;

interface Row {
  id: number;
  updated_at: string;
  orphaned_at: string | null;
  deleted_at: string | null;
  [key: string]: unknown;
}

function toDto(row: Row) {
  const { orphaned_at, deleted_at, ...rest } = row;
  return { ...rest, orphaned: orphaned_at !== null, deleted: deleted_at !== null };
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
  const limit = Math.min(
    Math.max(Number(params.get("limit")) || DEFAULT_LIMIT, 1),
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
  const rows = getDb()
    .prepare(
      `SELECT ${COLUMNS}
         FROM highlights h
        WHERE h.user_id = ?
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
