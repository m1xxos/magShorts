import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Remove a local publication, and its articles with it.
//
// Deliberately not dismissPublication(): that one writes the host into the
// list Discover uses to refuse a publication forever, and throwing a local
// paper out of the city digest says nothing about whether it belongs in the
// catalogue. Discovery not offering it again is handled by the city's own
// memory instead.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const feedId = Number(id);
  if (!Number.isInteger(feedId) || feedId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const db = getDb();
  const feed = db
    .prepare("SELECT id FROM feeds WHERE id = ? AND city IS NOT NULL")
    .get(feedId);
  if (!feed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  return NextResponse.json({ ok: true });
}
