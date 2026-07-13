import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { getDb } from "./db";

export const SESSION_COOKIE = "ms_session";
const SESSION_DAYS = 90;

export interface SessionUser {
  id: number;
  username: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export function createSession(userId: number): {
  token: string;
  maxAge: number;
} {
  const token = randomBytes(32).toString("hex");
  getDb()
    .prepare(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
    )
    .run(token, userId, `+${SESSION_DAYS} days`);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getSessionUser(request: NextRequest): SessionUser | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const user = db
    .prepare(
      `SELECT u.id, u.username FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as SessionUser | undefined;
  if (!user) return null;
  // Sliding expiry: top the session back up once it drops below 60 days left.
  db.prepare(
    `UPDATE sessions SET expires_at = datetime('now', ?)
     WHERE token = ? AND expires_at < datetime('now', '+60 days')`
  ).run(`+${SESSION_DAYS} days`, token);
  return user;
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
