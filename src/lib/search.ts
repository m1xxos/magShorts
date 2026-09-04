// Searching your subscriptions by title, tag and summary.
//
// An FTS5 index rather than LIKE, for reasons that are specific to this
// corpus: it is half Russian, and SQLite's LIKE is case-insensitive for ASCII
// only, so "железо" would never find "Железо". A leading-wildcard LIKE also
// cannot use an index, which on 8,500 articles means reading all of them.
//
// The body is deliberately not searched. article_content.text exists for 3% of
// articles — only the ones somebody opened or saved — so including it would
// find a word in the middle of one article and miss the same word in the next,
// for no reason a reader could see from the outside.

import { ARTICLE_COLUMNS, getDb } from "./db";
import { type ArticleDto } from "./types";

// Title first by a wide margin, then the tag, then the summary. Checked
// against the real 8,492: "kubernetes" and "apple" both put six title matches
// on top, and "железо" — which is a tag on this corpus and rarely a headline —
// correctly returns its tagged articles.
const WEIGHTS = "10.0, 6.0, 1.0";

// "tag:" is how the column filter is spelled for someone who is not going to
// learn FTS5 syntax.
const TAG_PREFIX = /^\s*(?:tag|тег):\s*/i;

// What the user typed never reaches SQLite as syntax. Words come out, and
// everything that could be an operator — quotes, stars, colons, NEAR, OR —
// goes in as literal text or not at all. A query of pure punctuation yields
// null and the caller answers with an empty list rather than an error.
function toMatch(input: string): string | null {
  const words = input.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words || words.length === 0) return null;
  // The last word gets a prefix star so the list narrows as you type; the
  // earlier ones are complete words by the time you have typed past them.
  return words
    .map((word, index) => `"${word}"` + (index === words.length - 1 ? "*" : ""))
    .join(" ");
}

export function searchArticles(
  query: string,
  limit: number,
  offset: number
): ArticleDto[] {
  const tagged = TAG_PREFIX.test(query);
  const match = toMatch(query.replace(TAG_PREFIX, ""));
  if (!match) return [];
  // Scoped to one column when asked, which is the whole of "search by tag".
  const expression = tagged ? `topic: ${match}` : match;

  return getDb()
    .prepare(
      `SELECT ${ARTICLE_COLUMNS}, f.title AS feed_title
         FROM articles_fts
         JOIN articles a ON a.id = articles_fts.rowid
         JOIN feeds f ON f.id = a.feed_id
        WHERE articles_fts MATCH ?
          -- The same scope the grid uses. Without it search is the one place
          -- in the app that hands back the Discover catalogue nobody
          -- subscribed to.
          AND f.enabled = 1 AND f.subscribed = 1
        ORDER BY bm25(articles_fts, ${WEIGHTS}), a.published_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(expression, limit, offset) as ArticleDto[];
}
