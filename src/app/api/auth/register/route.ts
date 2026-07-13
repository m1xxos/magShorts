import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  SESSION_COOKIE,
  createSession,
  hashPassword,
  sessionCookieOptions,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (username.length < 2 || username.length > 32) {
    return NextResponse.json(
      { error: "Username must be 2–32 characters" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(username);
  if (existing) {
    return NextResponse.json(
      { error: "This username is taken" },
      { status: 409 }
    );
  }

  const result = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, hashPassword(password));
  const userId = Number(result.lastInsertRowid);

  // The very first account inherits the pre-accounts reading list.
  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  if (userCount.n === 1) {
    db.prepare(
      "UPDATE reading_list SET user_id = ? WHERE user_id IS NULL"
    ).run(userId);
  }

  const session = createSession(userId);
  const response = NextResponse.json(
    { id: userId, username },
    { status: 201 }
  );
  response.cookies.set(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(session.maxAge)
  );
  return response;
}
