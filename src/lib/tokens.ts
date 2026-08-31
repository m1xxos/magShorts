// Bearer tokens for clients that are not a browser.
//
// A session belongs to a browser and slides forward every time it is used; a
// token belongs to a program, is typed in once, and is revoked by hand. The two
// do not share a table for that reason.

import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { type ApiTokenDto } from "./types";
import { type SessionUser } from "./auth";

// Long enough to say where it came from when it turns up in a log or a
// settings field somewhere it should not be.
const PREFIX = "msk_";
// The first characters, kept in the clear so the list can name a token without
// holding one. Includes the scheme prefix, so a row reads msk_1a2b3c4d.
const PREFIX_LENGTH = 12;

// sha256, not scrypt. This is 256 bits of generated entropy rather than a
// password: there is no dictionary to slow an attacker down against, and the
// lookup stays a single indexed read.
function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface MintedToken {
  token: string;
  row: ApiTokenDto;
}

// The only time the token itself exists outside the client. Nothing can read it
// back afterwards — the row holds a hash and the first few characters.
export function mintToken(userId: number, name: string): MintedToken {
  const token = PREFIX + randomBytes(32).toString("hex");
  const result = getDb()
    .prepare(
      `INSERT INTO api_tokens (user_id, name, token_hash, prefix)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, name, digest(token), token.slice(0, PREFIX_LENGTH));

  const row = getDb()
    .prepare(
      `SELECT id, name, prefix, created_at, last_used_at
         FROM api_tokens WHERE id = ?`
    )
    .get(result.lastInsertRowid) as ApiTokenDto;

  return { token, row };
}

// How stale last_used_at is allowed to get. Writing it on every request would
// put a disk write on every page of a sync to keep an audit field to the
// second, and nobody reads it to the second.
const TOUCH_AFTER = "-1 hour";

export function tokenUser(raw: string): SessionUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id AS token_id, u.id, u.username
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.revoked_at IS NULL`
    )
    .get(digest(raw)) as (SessionUser & { token_id: number }) | undefined;
  if (!row) return null;

  db.prepare(
    `UPDATE api_tokens SET last_used_at = datetime('now')
      WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', ?))`
  ).run(row.token_id, TOUCH_AFTER);

  return { id: row.id, username: row.username };
}

// Revoked tokens are not listed: the list answers "what can reach my
// highlights right now", and a revoked row cannot.
export function listTokens(userId: number): ApiTokenDto[] {
  return getDb()
    .prepare(
      `SELECT id, name, prefix, created_at, last_used_at
         FROM api_tokens
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC`
    )
    .all(userId) as ApiTokenDto[];
}

// A tombstone rather than a DELETE, so the hash of a leaked token stays taken
// and a revoked token can never be re-minted into existence by chance.
export function revokeToken(userId: number, id: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE api_tokens SET revoked_at = datetime('now')
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .run(id, userId);
  return result.changes > 0;
}
