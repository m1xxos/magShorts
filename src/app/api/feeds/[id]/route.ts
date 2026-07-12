import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const feedId = Number(id);
  if (!Number.isInteger(feedId)) {
    return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "enabled (boolean) is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE feeds SET enabled = ? WHERE id = ?")
    .run(body.enabled ? 1 : 0, feedId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }
  return NextResponse.json(db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const feedId = Number(id);
  if (!Number.isInteger(feedId)) {
    return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
