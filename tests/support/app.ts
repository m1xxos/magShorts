// A whole magShorts, on its own port, over its own database.
//
// Tests get a server with data they control rather than whatever happens to
// be in the dev database. Every bug this suite covers escaped because it was
// only ever checked by hand against real data, in one direction, from one
// starting page.

import { spawn, type ChildProcess } from "node:child_process";
import type BetterSqlite3 from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TestApp {
  baseUrl: string;
  cookie: string;
  dataDir: string;
  /** The seeded articles, in the order they were inserted. */
  articles: Array<{ id: number; title: string; topic: string | null }>;
  /** The same database the server is using, for tests that write to it.
   *  Left open on purpose: getDb() caches its handle, so closing it here
   *  leaves every later import holding a dead one. */
  db: BetterSqlite3.Database;
  stop: () => Promise<void>;
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// Fixtures chosen to pin the things that have actually broken: both alphabets,
// a tag that is a folder name, a title-only match, a summary-only match, and
// an article in a feed nobody subscribes to.
const FEEDS = [
  { title: "Habr", url: "https://habr.test/rss", subscribed: 1 },
  { title: "The Verge", url: "https://verge.test/rss", subscribed: 1 },
  { title: "Not subscribed", url: "https://catalog.test/rss", subscribed: 0 },
];

// Tags repeat on purpose: the tag list only offers a tag once at least two
// articles carry it, so one-of-each fixtures would produce no chips at all
// and every test about them would be testing nothing.
const ARTICLES = [
  { feed: 0, title: "Кубернетес для чайников", topic: "Kubernetes", summary: "Разбираем оркестрацию" },
  { feed: 0, title: "Почему процессор перегревается", topic: "Железо", summary: "Про термопасту" },
  { feed: 0, title: "Ещё про охлаждение", topic: "Железо", summary: "Вентиляторы" },
  { feed: 0, title: "Пишем на Python", topic: "Python", summary: "Скрипты и не только" },
  { feed: 0, title: "Python и асинхронность", topic: "Python", summary: "Корутины" },
  { feed: 1, title: "How to scale Kubernetes", topic: "Kubernetes", summary: "Top strategies" },
  { feed: 1, title: "A quiet week in tech", topic: "Magazines", summary: "Nothing about kubernetes here" },
  { feed: 1, title: "Another quiet week", topic: "Magazines", summary: "Still nothing" },
  { feed: 2, title: "Kubernetes in the catalog", topic: "Kubernetes", summary: "Should never be found" },
];

async function waitFor(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 401 || response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} never came up`);
}

export async function startApp(port: number): Promise<TestApp> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "magshorts-test-"));

  // Seeded in this process, before the server opens the file, so the server
  // finds a database that already has a user, a session and some articles.
  process.env.DATA_DIR = dataDir;
  const { getDb } = await import("../../src/lib/db");
  const { createSession, hashPassword } = await import("../../src/lib/auth");
  const db = getDb();
  // getDb seeds four real publications into an empty database. Left alone,
  // the scheduler then fetches them over the internet and the fixtures are
  // whatever Habr published this morning — which is exactly how a tag test
  // started counting three articles instead of two.
  db.exec("DELETE FROM articles; DELETE FROM feeds;");

  const user = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run("tester", hashPassword("secret"));
  const { token } = createSession(Number(user.lastInsertRowid));

  // Folders exist because the tag list excludes their names: ingest writes the
  // folder name into `topic` when an article has no category of its own, and
  // without a folder called Magazines there is nothing for that rule to catch.
  const folderIds = ["Magazines", "Blogs"].map((name) =>
    Number(
      db.prepare("INSERT INTO folders (name) VALUES (?)").run(name)
        .lastInsertRowid
    )
  );

  const feedIds = FEEDS.map(
    (feed) =>
      Number(
        db
          .prepare(
            "INSERT INTO feeds (title, url, subscribed, enabled, folder_id) VALUES (?, ?, ?, 1, ?)"
          )
          .run(feed.title, feed.url, feed.subscribed, folderIds[0]).lastInsertRowid
      )
  );

  const articles = ARTICLES.map((article, index) => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO articles (feed_id, guid, title, link, summary, topic, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          feedIds[article.feed],
          `guid-${index}`,
          article.title,
          `https://example.test/${index}`,
          article.summary,
          article.topic,
          new Date(Date.now() - index * 86_400_000).toISOString()
        ).lastInsertRowid
    );
    return { id, title: article.title, topic: article.topic };
  });

  // `next start`, not `next dev`: Next refuses a second dev server in the same
  // directory, so tests would fail whenever anyone had one running — which is
  // always, while working. It also means the suite exercises the build that
  // would ship rather than the dev server, so `npm run build` comes first.
  const server: ChildProcess = spawn(
    "npx",
    ["next", "start", "--port", String(port)],
    {
      cwd: ROOT,
      // No feed refreshing, no digests: the fixtures are the fixtures.
      env: { ...process.env, DATA_DIR: dataDir, SCHEDULER: "off" },
      stdio: process.env.TEST_SERVER_LOG ? "inherit" : "ignore",
    }
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(`${baseUrl}/api/me`);

  return {
    baseUrl,
    cookie: `ms_session=${token}`,
    dataDir,
    articles,
    db,
    stop: async () => {
      server.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 400));
      db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function api(
  app: TestApp,
  pathname: string
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(app.baseUrl + pathname, {
    headers: { cookie: app.cookie },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}
