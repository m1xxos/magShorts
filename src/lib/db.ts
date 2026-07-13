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
  feed_title?: string;
}

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
  `);
  db.pragma("foreign_keys = ON");

  const feedColumns = db.prepare("PRAGMA table_info(feeds)").all() as Array<{
    name: string;
  }>;
  if (!feedColumns.some((column) => column.name === "enabled")) {
    db.exec("ALTER TABLE feeds ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }

  const articleColumns = db
    .prepare("PRAGMA table_info(articles)")
    .all() as Array<{ name: string }>;
  if (!articleColumns.some((column) => column.name === "embedding")) {
    db.exec("ALTER TABLE articles ADD COLUMN embedding BLOB");
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
