import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export interface Feed {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  created_at: string;
  last_fetched_at: string | null;
  enabled: number;
  folder_id: number | null;
  // 0 = a Discover catalog publication rather than a subscription.
  subscribed: number;
  description: string | null;
  // Consecutive failed refreshes; any success sets it back to 0.
  failures: number;
}

export interface Folder {
  id: number;
  name: string;
  include_in_main: number;
  include_in_digest: number;
  position: number;
  created_at: string;
}

export interface Article {
  id: number;
  feed_id: number;
  guid: string;
  title: string;
  link: string;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  topic: string | null;
  content: string | null;
  feed_title?: string;
}

// The columns an article response may carry. `SELECT a.*` would also hand the
// client the 1.5 KB embedding vector and the full article body — both are
// server-side machinery, and together they dwarf the payload they ride on.
export const ARTICLE_COLUMNS =
  "a.id, a.feed_id, a.guid, a.title, a.link, a.summary, a.image_url, a.published_at, a.topic";

const DEFAULT_FEEDS: Array<{ title: string; url: string; site_url: string }> = [
  {
    title: "The Atlantic",
    url: "https://www.theatlantic.com/feed/all/",
    site_url: "https://www.theatlantic.com",
  },
  {
    title: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    site_url: "https://www.theverge.com",
  },
  {
    title: "The New York Times",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    site_url: "https://www.nytimes.com",
  },
  {
    title: "Habr",
    url: "https://habr.com/ru/rss/articles/?fl=ru",
    site_url: "https://habr.com",
  },
];

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, "magshorts.db"));
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      site_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      summary TEXT,
      image_url TEXT,
      published_at TEXT,
      UNIQUE(feed_id, guid)
    );

    CREATE INDEX IF NOT EXISTS idx_articles_published
      ON articles(published_at DESC);

    -- The taste profile joins every event to the article it came from, by
    -- link, and picks the newest event per link with a correlated subquery.
    -- Without this and its twin on user_events (below, where that table is
    -- declared) it is a nested scan of both tables — 880ms on 840 events,
    -- paid again by every For you, digest and Discover request.
    CREATE INDEX IF NOT EXISTS idx_articles_link
      ON articles(link);

    CREATE TABLE IF NOT EXISTS reading_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT,
      image_url TEXT,
      feed_title TEXT,
      published_at TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      article_id INTEGER,
      link TEXT NOT NULL,
      title TEXT,
      feed_id INTEGER,
      action TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_events_user
      ON user_events(user_id, created_at DESC);

    -- The other half of the taste-profile join; see idx_articles_link above.
    CREATE INDEX IF NOT EXISTS idx_user_events_user_link
      ON user_events(user_id, link);

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      include_in_main INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One frozen snapshot per user, kind and period: the digest page is a
    -- read, never a rebuild. llm_provider is NULL when the annotations came
    -- from the extractive fallback.
    CREATE TABLE IF NOT EXISTS digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      period_key TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      built_at TEXT NOT NULL DEFAULT (datetime('now')),
      three_lines TEXT NOT NULL,
      total_articles INTEGER NOT NULL,
      total_publications INTEGER NOT NULL,
      llm_provider TEXT,
      llm_model TEXT,
      UNIQUE(user_id, kind, period_key)
    );

    CREATE TABLE IF NOT EXISTS digest_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      section TEXT NOT NULL,
      position INTEGER NOT NULL,
      summary TEXT,
      reading_minutes INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_digest_items_digest
      ON digest_items(digest_id, section, position);

    -- The reader's extracted body, one row per article, written the first time
    -- someone opens or saves the article and never again. Its own table rather
    -- than columns on the articles table, for the same reason ARTICLE_COLUMNS
    -- exists: a body is tens of kilobytes and no list query should carry one.
    -- The cascade means the Discover trim (CATALOG_KEEP_ARTICLES) cleans up
    -- after itself.
    CREATE TABLE IF NOT EXISTS article_content (
      article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
      -- Sanitised body HTML; NULL when every hop of the unlock chain failed.
      html TEXT,
      -- The same body as plain text: reading time now, search later.
      text TEXT,
      -- JSON [{ id, text, level }] — the reader's outline.
      headings TEXT,
      reading_minutes INTEGER,
      -- 'ok' | 'failed'
      status TEXT NOT NULL,
      -- Which hop of the unlock chain answered: feed | direct | amp | marreta
      -- | archive. Shown in the reader, so it is never a mystery where the
      -- text came from.
      source TEXT,
      -- Consecutive failed extractions, so a dead link isn't refetched on
      -- every open. Reset by any success.
      attempts INTEGER NOT NULL DEFAULT 0,
      extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- A passage someone kept, and what they wrote about it.
    --
    -- Keyed on the link rather than the article id, like reading_list and for
    -- the same reason: the Discover trim deletes article rows, and a year of
    -- reading notes must not go with them. article_id is resolved at read time
    -- with a correlated subquery, so a trimmed-and-re-ingested article picks
    -- its highlights back up.
    --
    -- The title and publication are snapshots. An Obsidian note has to be
    -- writable even after the article itself is long gone.
    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      link TEXT NOT NULL,
      article_title TEXT NOT NULL,
      feed_title TEXT,
      published_at TEXT,
      -- The passage itself, normalised. This is the source of truth: offsets
      -- are a cache, the quote is the anchor.
      quote TEXT NOT NULL,
      -- Enough of either side to tell two identical sentences apart.
      prefix TEXT,
      suffix TEXT,
      -- Indices into the reader's normalised body frame, valid only while
      -- body_hash matches the body being read. Advisory, never authoritative.
      start_offset INTEGER,
      end_offset INTEGER,
      body_hash TEXT,
      -- Set when the passage could not be found in the article any more. The
      -- row is kept: an extraction that broke today is exactly when a note
      -- must not be lost, and it clears itself the next time it anchors.
      orphaned_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- A tombstone rather than a DELETE, so a plugin that already wrote the
      -- note in Obsidian learns the highlight went away. Purged after 90 days.
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_user_link
      ON highlights(user_id, link, start_offset);
    -- The sync cursor: (updated_at, id) in that order, which is exactly what
    -- the keyset pagination in /api/sync/highlights scans.
    CREATE INDEX IF NOT EXISTS idx_highlights_user_updated
      ON highlights(user_id, updated_at, id);

    -- Bearer tokens, for clients that are not a browser — the Obsidian plugin
    -- to begin with. Deliberately not a setting: GET /api/settings hands every
    -- key back unredacted.
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      -- sha256 of the token. Not scrypt: this is 256 bits of generated
      -- entropy rather than a password, so there is nothing to slow down for,
      -- and the lookup stays one indexed read.
      token_hash TEXT NOT NULL UNIQUE,
      -- The first characters, so the list can name a token without holding it.
      prefix TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user
      ON api_tokens(user_id, created_at DESC);
  `);
  db.pragma("foreign_keys = ON");

  const feedColumns = db.prepare("PRAGMA table_info(feeds)").all() as Array<{
    name: string;
  }>;
  if (!feedColumns.some((column) => column.name === "enabled")) {
    db.exec("ALTER TABLE feeds ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!feedColumns.some((column) => column.name === "folder_id")) {
    db.exec("ALTER TABLE feeds ADD COLUMN folder_id INTEGER REFERENCES folders(id)");
  }
  // A publication in the Discover catalog is one you haven't subscribed to:
  // same table, same ingest, same embeddings — it just never appears in the
  // grid, Shorts, For you or the digest. Existing feeds are all subscriptions.
  if (!feedColumns.some((column) => column.name === "subscribed")) {
    db.exec("ALTER TABLE feeds ADD COLUMN subscribed INTEGER NOT NULL DEFAULT 1");
  }
  // One sentence about what the publication is, written once and cached.
  if (!feedColumns.some((column) => column.name === "description")) {
    db.exec("ALTER TABLE feeds ADD COLUMN description TEXT");
  }
  // Consecutive failed refreshes, reset by any success. A catalog that fills
  // itself needs to empty itself too: a publication that has moved or shut
  // down otherwise stays on the refresh list forever, quietly failing.
  if (!feedColumns.some((column) => column.name === "failures")) {
    db.exec("ALTER TABLE feeds ADD COLUMN failures INTEGER NOT NULL DEFAULT 0");
  }

  // Ingest looks an article up by (feed_id, link) on every item of every feed,
  // so this index is the difference between a lookup and a scan. Its absence
  // also marks a database that has never been de-duplicated, which is why the
  // one-time cleanup below is guarded by it rather than by a version row.
  const articleIndexes = db
    .prepare("PRAGMA index_list(articles)")
    .all() as Array<{ name: string }>;
  if (!articleIndexes.some((index) => index.name === "idx_articles_feed_link")) {
    // Publishers change guid schemes, and a reader keyed on the guid stores
    // the whole feed a second time when they do: The Atlantic switched from
    // RSS to Atom and arrived with 25 new ids for 25 articles already on file.
    // Ingest now keeps the guid it already has for a link, so this cannot
    // happen again — but the copies already made have to go, and the oldest
    // row is the one to keep, since it carries the embedding and whatever is
    // pointing at it.
    const removed = db
      .prepare(
        `DELETE FROM articles WHERE id NOT IN (
           SELECT MIN(id) FROM articles GROUP BY feed_id, link
         )`
      )
      .run();
    if (removed.changes > 0) {
      console.log(`[db] removed ${removed.changes} duplicate article(s)`);
    }
    db.exec(
      "CREATE INDEX idx_articles_feed_link ON articles(feed_id, link)"
    );
  }

  // Feeds that publish site-relative item links (Harper's does) used to be
  // stored raw, which left the article unfetchable and the card pointing
  // nowhere. Ingest resolves them now; these are the rows made before it did.
  const relative = db
    .prepare(
      `SELECT a.id, a.link, f.site_url, f.url FROM articles a
       JOIN feeds f ON f.id = a.feed_id
       WHERE a.link NOT LIKE 'http%'`
    )
    .all() as Array<{ id: number; link: string; site_url: string | null; url: string }>;
  if (relative.length > 0) {
    const fix = db.prepare("UPDATE articles SET link = ? WHERE id = ?");
    let fixed = 0;
    for (const row of relative) {
      try {
        fix.run(new URL(row.link, row.site_url ?? row.url).toString(), row.id);
        fixed++;
      } catch {
        // Nothing sensible to resolve against; leave the row alone.
      }
    }
    console.log(`[db] resolved ${fixed} relative article link(s)`);
  }

  // Tombstones exist so a plugin can learn a highlight was deleted; once every
  // plausible client has synced, they are just rows.
  const stale = db
    .prepare(
      "DELETE FROM highlights WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-90 days')"
    )
    .run();
  if (stale.changes > 0) {
    console.log(`[db] purged ${stale.changes} deleted highlight(s)`);
  }

  // The Omnivore integration is gone. Its credentials should not outlive it in
  // a database that hands every setting back unredacted.
  const omnivore = db
    .prepare(
      "DELETE FROM settings WHERE key IN ('omnivore_url', 'omnivore_api_key')"
    )
    .run();
  if (omnivore.changes > 0) {
    console.log(`[db] removed ${omnivore.changes} stored Omnivore credential(s)`);
  }

  // Pictures stored before the reader asked for a synchronous decode. On an
  // iPad they blink out for a frame and back while you scroll past them —
  // WebKit hands the page an empty box and fills it when the off-thread decode
  // lands. The extractor sets the attribute now; these are the bodies written
  // before it did, and re-extracting every one of them to add nine characters
  // would mean fetching every publisher again.
  const undecoded = db
    .prepare(
      "SELECT COUNT(*) AS n FROM article_content WHERE html LIKE '%<img %' AND html NOT LIKE '%decoding=%'"
    )
    .get() as { n: number };
  if (undecoded.n > 0) {
    db.prepare(
      `UPDATE article_content
          SET html = replace(html, '<img ', '<img decoding="sync" ')
        WHERE html LIKE '%<img %' AND html NOT LIKE '%decoding=%'`
    ).run();
    console.log(`[db] marked pictures in ${undecoded.n} stored article(s) for synchronous decoding`);
  }

  const articleColumns = db
    .prepare("PRAGMA table_info(articles)")
    .all() as Array<{ name: string }>;
  if (!articleColumns.some((column) => column.name === "embedding")) {
    db.exec("ALTER TABLE articles ADD COLUMN embedding BLOB");
  }
  if (!articleColumns.some((column) => column.name === "topic")) {
    db.exec("ALTER TABLE articles ADD COLUMN topic TEXT");
  }
  // The article body as the feed shipped it, for the digest's annotations.
  // Rows ingested before this landed stay NULL and fall back to a page fetch.
  if (!articleColumns.some((column) => column.name === "content")) {
    db.exec("ALTER TABLE articles ADD COLUMN content TEXT");
  }

  // How long the reader was actually open, in seconds. Nullable on purpose:
  // NULL means the event predates measurement, and "Your reading" has to tell
  // a measured minute from an estimated one rather than quietly averaging the
  // two together.
  const eventColumns = db
    .prepare("PRAGMA table_info(user_events)")
    .all() as Array<{ name: string }>;
  if (!eventColumns.some((column) => column.name === "seconds")) {
    db.exec("ALTER TABLE user_events ADD COLUMN seconds INTEGER");
  }

  // What search reads. An index rather than a LIKE scan, for two reasons that
  // are both about this corpus: half of it is Russian, and SQLite's LIKE is
  // case-insensitive for ASCII only — so "железо" would never find "Железо" —
  // and a leading-wildcard LIKE cannot use an index at all.
  //
  // external content: the text stays in `articles` and is not stored a second
  // time. That buys correctness work instead: the three triggers below are the
  // only thing keeping the index and the table telling the same story, and
  // every way an article leaves has to go through one of them. Both do — the
  // Discover trim and the de-duplication above are plain DELETEs on articles.
  //
  // unicode61 rather than porter: porter stems English, and applying it to a
  // corpus that is half Russian would be wrong for half the rows.
  const searchIndexed = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'articles_fts'")
    .get();
  if (!searchIndexed) {
    db.exec(`
      CREATE VIRTUAL TABLE articles_fts USING fts5(
        title, topic, summary,
        content=articles,
        content_rowid=id,
        tokenize="unicode61 remove_diacritics 2"
      );

      CREATE TRIGGER articles_fts_insert AFTER INSERT ON articles BEGIN
        INSERT INTO articles_fts (rowid, title, topic, summary)
        VALUES (new.id, new.title, new.topic, new.summary);
      END;

      -- 'delete' in single quotes: double quotes make SQLite read it as a
      -- column name and the trigger fails to compile.
      CREATE TRIGGER articles_fts_delete AFTER DELETE ON articles BEGIN
        INSERT INTO articles_fts (articles_fts, rowid, title, topic, summary)
        VALUES ('delete', old.id, old.title, old.topic, old.summary);
      END;

      CREATE TRIGGER articles_fts_update AFTER UPDATE ON articles BEGIN
        INSERT INTO articles_fts (articles_fts, rowid, title, topic, summary)
        VALUES ('delete', old.id, old.title, old.topic, old.summary);
        INSERT INTO articles_fts (rowid, title, topic, summary)
        VALUES (new.id, new.title, new.topic, new.summary);
      END;
    `);
    const indexed = db
      .prepare(
        `INSERT INTO articles_fts (rowid, title, topic, summary)
         SELECT id, title, topic, summary FROM articles`
      )
      .run();
    console.log(`[db] search index built over ${indexed.changes} articles`);
  }

  // The digest picks its sources independently of For you: "what should I read
  // now" and "what did I miss overnight" are different questions, and a folder
  // of blogs can reasonably answer only the second. Seeded from the For you
  // toggle so switching to two columns changes nothing until asked.
  const folderColumns = db.prepare("PRAGMA table_info(folders)").all() as Array<{
    name: string;
  }>;
  if (!folderColumns.some((column) => column.name === "include_in_digest")) {
    db.exec(`
      ALTER TABLE folders ADD COLUMN include_in_digest INTEGER NOT NULL DEFAULT 1;
      UPDATE folders SET include_in_digest = include_in_main;
    `);
  }

  // reading_list v1 was single-user with UNIQUE(link); rebuild it per-user.
  // Legacy rows keep user_id NULL and are claimed by the first registered user.
  const readingColumns = db
    .prepare("PRAGMA table_info(reading_list)")
    .all() as Array<{ name: string }>;
  if (!readingColumns.some((column) => column.name === "user_id")) {
    db.exec(`
      CREATE TABLE reading_list_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        link TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        image_url TEXT,
        feed_title TEXT,
        published_at TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, link)
      );
      INSERT INTO reading_list_v2
        (id, user_id, link, title, summary, image_url, feed_title, published_at, added_at)
      SELECT id, NULL, link, title, summary, image_url, feed_title, published_at, added_at
      FROM reading_list;
      DROP TABLE reading_list;
      ALTER TABLE reading_list_v2 RENAME TO reading_list;
    `);
  }

  const feedCount = db.prepare("SELECT COUNT(*) AS n FROM feeds").get() as {
    n: number;
  };
  if (feedCount.n === 0) {
    const insert = db.prepare(
      "INSERT INTO feeds (title, url, site_url) VALUES (?, ?, ?)"
    );
    for (const feed of DEFAULT_FEEDS) {
      insert.run(feed.title, feed.url, feed.site_url);
    }
  }

  return db;
}
