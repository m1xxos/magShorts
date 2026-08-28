import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Where the reader found each highlight this time round.
//
// Its own route, and a batch, because an article whose extraction is only
// partial is re-extracted on *every* open — so its body fingerprint changes
// every time and forty highlights would otherwise mean forty PATCHes per open.
//
// Deliberately does NOT touch updated_at. Re-anchoring is bookkeeping, not an
// edit: if it bumped the timestamp, every open of an article would look like a
// change to the sync cursor and the Obsidian plugin would rewrite every note.
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
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }

  const db = getDb();
  const anchored = db.prepare(
    `UPDATE highlights
        SET start_offset = ?, end_offset = ?, body_hash = ?, orphaned_at = NULL
      WHERE id = ? AND user_id = ?`
  );
  const orphaned = db.prepare(
    `UPDATE highlights
        SET orphaned_at = COALESCE(orphaned_at, datetime('now'))
      WHERE id = ? AND user_id = ?`
  );

  const write = db.transaction((rows: Array<Record<string, unknown>>) => {
    let changed = 0;
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isInteger(id)) continue;
      if (row.orphaned === true) {
        changed += orphaned.run(id, user.id).changes;
        continue;
      }
      if (!Number.isInteger(row.start_offset) || !Number.isInteger(row.end_offset)) {
        continue;
      }
      changed += anchored.run(
        row.start_offset as number,
        row.end_offset as number,
        typeof row.body_hash === "string" ? row.body_hash : null,
        id,
        user.id
      ).changes;
    }
    return changed;
  });

  return NextResponse.json({ updated: write(items as Array<Record<string, unknown>>) });
}
