import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NOTE_MAX = 10_000;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const highlightId = Number(id);
  if (!Number.isInteger(highlightId)) {
    return NextResponse.json({ error: "Invalid highlight id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.note !== "string" && body.note !== null) {
    return NextResponse.json({ error: "Nothing to update: pass note" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, NOTE_MAX).trim() : "";

  const result = getDb()
    .prepare(
      `UPDATE highlights SET note = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    )
    .run(note || null, highlightId, user.id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// A tombstone rather than a DELETE. A plugin that has already written this
// highlight into a note has to be able to learn that it went away; a row that
// simply vanishes is a note that lives forever.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const highlightId = Number(id);
  if (!Number.isInteger(highlightId)) {
    return NextResponse.json({ error: "Invalid highlight id" }, { status: 400 });
  }

  const result = getDb()
    .prepare(
      `UPDATE highlights
          SET deleted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    )
    .run(highlightId, user.id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
