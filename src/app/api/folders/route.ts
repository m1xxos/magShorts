import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const folders = getDb()
    .prepare(
      `SELECT fo.*, COUNT(f.id) AS feed_count
       FROM folders fo LEFT JOIN feeds f ON f.folder_id = fo.id
       GROUP BY fo.id ORDER BY fo.position ASC, fo.created_at ASC`
    )
    .all();
  return NextResponse.json(folders);
}

export async function POST(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let name: string;
  let includeInMain = true;
  try {
    const body = await request.json();
    name = String(body.name ?? "").trim();
    if (typeof body.include_in_main === "boolean") {
      includeInMain = body.include_in_main;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM folders WHERE name = ?")
    .get(name);
  if (existing) {
    return NextResponse.json(
      { error: "A folder with this name already exists" },
      { status: 409 }
    );
  }
  const result = db
    .prepare("INSERT INTO folders (name, include_in_main) VALUES (?, ?)")
    .run(name, includeInMain ? 1 : 0);
  const folder = db
    .prepare("SELECT *, 0 AS feed_count FROM folders WHERE id = ?")
    .get(Number(result.lastInsertRowid));
  return NextResponse.json(folder, { status: 201 });
}
