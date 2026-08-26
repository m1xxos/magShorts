import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const QUOTE_MAX = 5000;
const NOTE_MAX = 10_000;
const CONTEXT_MAX = 200;

// article_id is resolved from the link rather than stored, for the reason
// reading_list does the same: the Discover trim deletes article rows and a
// highlight has to outlive that.
const COLUMNS = `h.id, h.link, h.article_title, h.feed_title, h.published_at,
   h.quote, h.prefix, h.suffix, h.start_offset, h.end_offset, h.body_hash,
   h.orphaned_at, h.note, h.created_at, h.updated_at,
   (SELECT a.id FROM articles a WHERE a.link = h.link ORDER BY a.id LIMIT 1)
     AS article_id`;

interface Row {
  orphaned_at: string | null;
  [key: string]: unknown;
}

function toDto(row: Row) {
  const { orphaned_at, ...rest } = row;
  return { ...rest, orphaned: orphaned_at !== null };
}

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const link = request.nextUrl.searchParams.get("link");

  // One article, in reading order — what the reader asks for on open.
  if (link) {
    const rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM highlights h
          WHERE h.user_id = ? AND h.link = ? AND h.deleted_at IS NULL
          ORDER BY h.start_offset ASC, h.id ASC`
      )
      .all(user.id, link) as Row[];
    return NextResponse.json(rows.map(toDto));
  }

  // Everything, newest first — what the Highlights page asks for.
  const limit = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get("limit")) || 100, 1),
    500
  );
  const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM highlights h
        WHERE h.user_id = ? AND h.deleted_at IS NULL
        ORDER BY h.created_at DESC, h.id DESC
        LIMIT ? OFFSET ?`
    )
    .all(user.id, limit, offset) as Row[];
  return NextResponse.json(rows.map(toDto));
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
  const title = typeof body.article_title === "string" ? body.article_title.trim() : "";
  const quote = typeof body.quote === "string" ? body.quote.trim() : "";
  if (!/^https?:\/\//.test(link) || !title || !quote) {
    return NextResponse.json(
      { error: "link, article_title and quote are required" },
      { status: 400 }
    );
  }
  if (quote.length > QUOTE_MAX) {
    return NextResponse.json({ error: "That passage is too long" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, NOTE_MAX) : null;

  const db = getDb();
  const inserted = db
    .prepare(
      `INSERT INTO highlights
         (user_id, link, article_title, feed_title, published_at, quote,
          prefix, suffix, start_offset, end_offset, body_hash, note)
       VALUES (@user_id, @link, @article_title, @feed_title, @published_at, @quote,
          @prefix, @suffix, @start_offset, @end_offset, @body_hash, @note)`
    )
    .run({
      user_id: user.id,
      link,
      article_title: title,
      feed_title: typeof body.feed_title === "string" ? body.feed_title : null,
      published_at: typeof body.published_at === "string" ? body.published_at : null,
      quote,
      prefix: typeof body.prefix === "string" ? body.prefix.slice(0, CONTEXT_MAX) : null,
      suffix: typeof body.suffix === "string" ? body.suffix.slice(0, CONTEXT_MAX) : null,
      start_offset: Number.isInteger(body.start_offset) ? (body.start_offset as number) : null,
      end_offset: Number.isInteger(body.end_offset) ? (body.end_offset as number) : null,
      body_hash: typeof body.body_hash === "string" ? body.body_hash : null,
      note: note || null,
    });

  const row = db
    .prepare(`SELECT ${COLUMNS} FROM highlights h WHERE h.id = ?`)
    .get(Number(inserted.lastInsertRowid)) as Row;
  return NextResponse.json(toDto(row), { status: 201 });
}
