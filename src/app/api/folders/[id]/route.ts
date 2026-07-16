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
  const folderId = Number(id);
  if (!Number.isInteger(folderId)) {
    return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (typeof body.include_in_main === "boolean") {
    updates.push("include_in_main = ?");
    values.push(body.include_in_main ? 1 : 0);
  }
  if (typeof body.position === "number" && Number.isInteger(body.position)) {
    updates.push("position = ?");
    values.push(body.position);
  }
  if (updates.length === 0) {
    return NextResponse.json(
      { error: "Nothing to update: pass name, include_in_main or position" },
      { status: 400 }
    );
  }

  const db = getDb();
  try {
    const result = db
      .prepare(`UPDATE folders SET ${updates.join(", ")} WHERE id = ?`)
      .run(...values, folderId);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  } catch {
    return NextResponse.json(
      { error: "A folder with this name already exists" },
      { status: 409 }
    );
  }
  return NextResponse.json(
    db.prepare("SELECT * FROM folders WHERE id = ?").get(folderId)
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const folderId = Number(id);
  if (!Number.isInteger(folderId)) {
    return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
  }

  const db = getDb();
  // Feeds survive folder deletion — they just move back to the root group.
  const remove = db.transaction(() => {
    db.prepare("UPDATE feeds SET folder_id = NULL WHERE folder_id = ?").run(
      folderId
    );
    return db.prepare("DELETE FROM folders WHERE id = ?").run(folderId);
  });
  if (remove().changes === 0) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
