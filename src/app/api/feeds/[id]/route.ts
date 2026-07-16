import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const db = getDb();
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof body.enabled === "boolean") {
    updates.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }
  if (typeof body.title === "string" && body.title.trim()) {
    updates.push("title = ?");
    values.push(body.title.trim());
  }
  if (body.folder_id !== undefined) {
    if (body.folder_id === null) {
      updates.push("folder_id = NULL");
    } else if (Number.isInteger(body.folder_id)) {
      const folder = db
        .prepare("SELECT id FROM folders WHERE id = ?")
        .get(body.folder_id);
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      updates.push("folder_id = ?");
      values.push(body.folder_id);
    } else {
      return NextResponse.json({ error: "Invalid folder_id" }, { status: 400 });
    }
  }
  if (updates.length === 0) {
    return NextResponse.json(
      { error: "Nothing to update: pass enabled, title or folder_id" },
      { status: 400 }
    );
  }

  const result = db
    .prepare(`UPDATE feeds SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values, feedId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }
  return NextResponse.json(db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId));
}

export async function DELETE(
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
  const result = db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  if (result.changes === 0) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
