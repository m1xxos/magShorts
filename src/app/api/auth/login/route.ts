import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  SESSION_COOKIE,
  createSession,
  sessionCookieOptions,
  verifyPassword,
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

  const user = getDb()
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(username) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json(
      { error: "Wrong username or password" },
      { status: 401 }
    );
  }

  const session = createSession(user.id);
  const response = NextResponse.json({ id: user.id, username: user.username });
  response.cookies.set(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(session.maxAge)
  );
  return response;
}
