import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionUser = getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = getDb()
    .prepare(
      "SELECT id, username, email, email_weekly_digest FROM users WHERE id = ?"
    )
    .get(sessionUser.id) as
    | {
        id: number;
        username: string;
        email: string | null;
        email_weekly_digest: number;
      }
    | undefined;

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(request: NextRequest) {
  const sessionUser = getSessionUser(request);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const db = getDb();
  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.email !== undefined) {
    if (typeof body.email !== "string" && body.email !== null) {
      return NextResponse.json(
        { error: "Email must be a string or null" },
        { status: 400 }
      );
    }
    const emailVal = typeof body.email === "string" ? body.email.trim() : null;
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }
    updates.push("email = ?");
    params.push(emailVal || null);
  }

  if (body.email_weekly_digest !== undefined) {
    const enabled =
      body.email_weekly_digest === 1 ||
      body.email_weekly_digest === true ||
      body.email_weekly_digest === "1"
        ? 1
        : 0;
    updates.push("email_weekly_digest = ?");
    params.push(enabled);
  }

  if (updates.length > 0) {
    params.push(sessionUser.id);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(
      ...params
    );
  }

  const updated = db
    .prepare(
      "SELECT id, username, email, email_weekly_digest FROM users WHERE id = ?"
    )
    .get(sessionUser.id);

  return NextResponse.json(updated);
}
