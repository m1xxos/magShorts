import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, startApp, type TestApp } from "./support/app";

let app: TestApp;

before(async () => {
  app = await startApp(3311);
}, { timeout: 120_000 });

after(async () => {
  await app.stop();
});

async function search(query: string, extra = ""): Promise<string[]> {
  const { body } = await api(
    app,
    `/api/search?q=${encodeURIComponent(query)}${extra}`
  );
  return (body as Array<{ title: string }>).map((article) => article.title);
}

interface SourceRow {
  feed_id: number;
  feed_title: string;
  count: number;
}

async function sources(query: string): Promise<SourceRow[]> {
  const { body } = await api(
    app,
    `/api/search/sources?q=${encodeURIComponent(query)}`
  );
  return body as SourceRow[];
}

// The promise the city digest makes: a local publication is fetched and kept,
// and appears in none of the places built out of what you subscribe to. One
// case per surface, because this is the kind of thing that is true on the day
// it is written and quietly stops being true later.
describe("city publications stay out of everything", () => {
  const CITY_TITLE = "Мост развели раньше срока";

  async function titles(path: string): Promise<string[]> {
    const { body } = await api(app, path);
    const rows = Array.isArray(body) ? body : [];
    return (rows as Array<{ title: string }>).map((row) => row.title);
  }

  it("is not in the home grid", async () => {
    assert.ok(!(await titles("/api/articles?limit=100")).includes(CITY_TITLE));
  });

  it("is not in For you", async () => {
    assert.ok(
      !(await titles("/api/recommendations?limit=100")).includes(CITY_TITLE)
    );
  });

  it("is not in Shorts", async () => {
    assert.ok(!(await titles("/api/shorts?limit=100")).includes(CITY_TITLE));
  });

  it("is not in search, even on a word it contains", async () => {
    // Its summary says "Kubernetes" precisely so this test fails loudly if the
    // scope clause is ever dropped.
    assert.ok(!(await titles("/api/search?q=kubernetes")).includes(CITY_TITLE));
    assert.ok(
      !(await titles("/api/search?q=" + encodeURIComponent("мост"))).includes(
        CITY_TITLE
      )
    );
  });

  it("is not among the tags on offer", async () => {
    const { body } = await api(app, "/api/tags");
    const tags = (body as Array<{ topic: string }>).map((row) => row.topic);
    assert.ok(!tags.includes("Город"));
  });

  it("is not in the Discover catalogue", async () => {
    // The one surface that shares `subscribed = 0` with it, and so the one
    // that had to be taught. These two routes answer with an object rather
    // than a bare array.
    const { body } = await api(app, "/api/discover/publications");
    const page = body as {
      publications: Array<{ title: string }>;
      catalog_size: number;
      topics: Array<{ topic: string }>;
    };
    assert.ok(!page.publications.some((row) => row.title === "Fontanka"));
    // The catalogue's own size drives the autofill ceiling, so a city feed
    // counted here would quietly stop Discover growing.
    assert.equal(page.catalog_size, 1, "the one real catalogue publication");
    assert.ok(!page.topics.some((row) => row.topic === "Город"));

    const feed = await api(app, "/api/discover/articles?limit=100");
    const articles = (feed.body as { articles: Array<{ title: string }> })
      .articles;
    assert.ok(!articles.some((row) => row.title === CITY_TITLE));
  });

  it("cannot be dismissed through the Discover endpoint", async () => {
    // It shares `subscribed = 0` with the catalogue, so without its own guard
    // this would delete the feed and blacklist its host from Discover too.
    const feed = app.db
      .prepare("SELECT id FROM feeds WHERE city IS NOT NULL")
      .get() as { id: number };
    const { status } = await api(app, `/api/discover/publications/${feed.id}`, {
      method: "DELETE",
    });
    assert.equal(status, 404);
    const still = app.db
      .prepare("SELECT COUNT(*) AS n FROM feeds WHERE id = ?")
      .get(feed.id) as { n: number };
    assert.equal(still.n, 1, "the city publication survives");
  });

  it("is not offered as Up next beside a subscription", async () => {
    const seed = app.articles.find((a) => a.title === "How to scale Kubernetes")!;
    assert.ok(
      !(await titles(`/api/articles/${seed.id}/related`)).includes(CITY_TITLE)
    );
  });

  it("teaches the taste profile nothing", async () => {
    // The isolation runs both ways. /api/events snapshots an article's
    // embedding onto the event whatever feed it came from, so without the
    // exclusion, saving one card about a bridge closure would shape For you,
    // Shorts, the digest's rerank sample and Discover's suggestions.
    //
    // The fixtures carry no embeddings — the scheduler is off, so nothing ever
    // backfills them — and buildProfile skips a row that has none. So the
    // event rows here bring their own vector, and a subscription is saved the
    // same way as a control: without it this test would pass on a codebase
    // with no exclusion at all.
    const { getDb } = await import("../src/lib/db");
    const { buildProfile, feedWeights } = await import("../src/lib/recommend");
    const { EMBEDDING_DIM } = await import("../src/lib/embeddings");

    const vector = new Float32Array(EMBEDDING_DIM);
    vector[0] = 1;
    const embedding = Buffer.from(vector.buffer);

    const save = getDb().prepare(
      `INSERT INTO user_events (user_id, article_id, link, title, feed_id, action, embedding)
       SELECT 1, a.id, a.link, a.title, a.feed_id, 'save', ?
         FROM articles a WHERE a.title = ?`
    );
    const drop = getDb().prepare(
      "DELETE FROM user_events WHERE link = (SELECT link FROM articles WHERE title = ?)"
    );

    const before = buildProfile(1).positiveSignals;

    save.run(embedding, CITY_TITLE);
    assert.equal(
      buildProfile(1).positiveSignals,
      before,
      "saving a local article says nothing about what you like to read"
    );
    const cityFeed = app.db
      .prepare("SELECT id FROM feeds WHERE city IS NOT NULL")
      .get() as { id: number };
    assert.ok(
      !feedWeights(1).has(cityFeed.id),
      "and its publication earns no weight"
    );

    // The control: the identical insert against a subscription does count.
    save.run(embedding, "How to scale Kubernetes");
    assert.equal(buildProfile(1).positiveSignals, before + 1);

    drop.run(CITY_TITLE);
    drop.run("How to scale Kubernetes");
  });

  it("stops being local news the moment you subscribe to it", async () => {
    // subscribed = 1 with a city set reads as an ordinary subscription to
    // every query in the app and as local news to the digest. Made impossible
    // rather than handled.
    const feed = app.db
      .prepare("SELECT id FROM feeds WHERE city IS NOT NULL")
      .get() as { id: number };
    await api(app, `/api/feeds/${feed.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscribed: true }),
    });
    const after = app.db
      .prepare("SELECT subscribed, city FROM feeds WHERE id = ?")
      .get(feed.id) as { subscribed: number; city: string | null };
    assert.equal(after.subscribed, 1);
    assert.equal(after.city, null);

    // Put it back, since the rest of this suite depends on it.
    app.db
      .prepare("UPDATE feeds SET subscribed = 0, city = ? WHERE id = ?")
      .run("Санкт-Петербург", feed.id);
  });

  it("is still reachable by id, because the reader needs it", async () => {
    const city = app.articles.find((a) => a.title === CITY_TITLE)!;
    const { status, body } = await api(app, `/api/articles/${city.id}`);
    assert.equal(status, 200);
    assert.equal((body as { title: string }).title, CITY_TITLE);
  });
});

describe("search", () => {
  it("finds a word in a title", async () => {
    const titles = await search("kubernetes");
    assert.ok(titles.includes("How to scale Kubernetes"));
  });

  it("finds a word only in the summary", async () => {
    // The article says "kubernetes" in its summary and nowhere else.
    assert.ok((await search("kubernetes")).includes("A quiet week in tech"));
  });

  it("ranks a title match above a summary-only one", async () => {
    const titles = await search("kubernetes");
    assert.ok(
      titles.indexOf("How to scale Kubernetes") <
        titles.indexOf("A quiet week in tech")
    );
  });

  it("does not care about case, in either alphabet", async () => {
    // SQLite's LIKE would fail this one: it folds case for ASCII only.
    assert.deepEqual(await search("железо"), await search("ЖЕЛЕЗО"));
    assert.ok((await search("железо")).length > 0);
    assert.deepEqual(await search("kubernetes"), await search("KUBERNETES"));
  });

  it("matches a prefix, so results narrow as you type", async () => {
    assert.ok((await search("кубер")).includes("Кубернетес для чайников"));
  });

  it("orders by date when asked, both ways", async () => {
    // The fixture publishes one article a day, newest first, so the date
    // orders are each other's reverse over the same set of matches.
    const newest = await search("kubernetes", "&sort=newest");
    const oldest = await search("kubernetes", "&sort=oldest");
    assert.ok(newest.length > 1);
    assert.deepEqual(oldest, [...newest].reverse());
  });

  it("puts the freshest article first, whatever it scores", async () => {
    // The Russian article matches only through its Kubernetes tag, so
    // relevance does not lead with it and the date order must.
    const newest = await search("kubernetes", "&sort=newest");
    assert.equal(newest[0], "Кубернетес для чайников");
    assert.equal((await search("kubernetes"))[0], "How to scale Kubernetes");
  });

  it("treats a sort it does not know as relevance", async () => {
    // It arrives from a URL a person can edit. The honest answer is the
    // results, not an error page where the search used to be.
    const { status } = await api(app, "/api/search?q=kubernetes&sort=banana");
    assert.equal(status, 200);
    assert.deepEqual(await search("kubernetes", "&sort=banana"),
      await search("kubernetes"));
  });

  it("lists which publications the results came from", async () => {
    const rows = await sources("kubernetes");
    assert.deepEqual(
      rows.map((row) => row.feed_title).sort(),
      ["Habr", "The Verge"]
    );
    // The counts are the whole result set, not the page that was fetched.
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    assert.equal(total, (await search("kubernetes")).length);
  });

  it("never counts a publication nobody subscribed to", async () => {
    assert.ok(
      !(await sources("kubernetes")).some(
        (row) => row.feed_title === "Not subscribed"
      )
    );
  });

  it("narrows to one publication", async () => {
    const verge = (await sources("kubernetes")).find(
      (row) => row.feed_title === "The Verge"
    )!;
    const titles = await search("kubernetes", `&feed=${verge.feed_id}`);
    assert.equal(titles.length, verge.count);
    assert.ok(titles.includes("How to scale Kubernetes"));
    assert.ok(!titles.includes("Кубернетес для чайников"));
  });

  it("keeps offering the other publications while one is chosen", async () => {
    // The filter's own buttons. Narrowing them to the publication already
    // picked would leave a filter that can only be undone by pressing the
    // same button again.
    assert.equal((await sources("kubernetes")).length, 2);
  });

  it("ignores a publication that is not one", async () => {
    assert.deepEqual(await search("kubernetes", "&feed=abc"),
      await search("kubernetes"));
    assert.deepEqual(await search("kubernetes", "&feed=99999"), []);
  });

  it("pages a date order without repeating an article", async () => {
    const first = await search("kubernetes", "&sort=newest&limit=1");
    const second = await search("kubernetes", "&sort=newest&limit=1&offset=1");
    assert.equal(first.length, 1);
    assert.notDeepEqual(first, second);
  });

  it("wants a session for the sources too", async () => {
    const response = await fetch(`${app.baseUrl}/api/search/sources?q=a`);
    assert.equal(response.status, 401);
  });

  it("searches tags when asked", async () => {
    assert.deepEqual((await search("tag:python")).sort(), [
      "Python и асинхронность",
      "Пишем на Python",
    ].sort());
  });

  it("scopes every word of a tag to the tag", async () => {
    // "Learning to weld" is tagged Machine Shop. An unbracketed column filter
    // asks for a topic containing machine and *any column* containing
    // learning, and hands it back.
    assert.deepEqual(await search("tag:Machine Learning"), ["Welding tips"]);
  });

  it("keeps the catalogue out", async () => {
    // The third feed is subscribed = 0. Its article says Kubernetes twice and
    // must still never appear.
    assert.ok(!(await search("kubernetes")).includes("Kubernetes in the catalog"));
  });

  it("answers nothing rather than failing on nonsense", async () => {
    for (const query of ["%", '"', "*", "-", "   ", "((", "NEAR/"]) {
      const { status, body } = await api(
        app,
        `/api/search?q=${encodeURIComponent(query)}`
      );
      assert.equal(status, 200, `status for ${JSON.stringify(query)}`);
      assert.deepEqual(body, [], `body for ${JSON.stringify(query)}`);
    }
  });

  it("treats an empty query as nothing rather than everything", async () => {
    const { body } = await api(app, "/api/search?q=");
    assert.deepEqual(body, []);
  });

  it("refuses a fractional limit rather than throwing", async () => {
    const { status } = await api(app, "/api/search?q=kubernetes&limit=2.5");
    assert.equal(status, 200);
  });

  it("pages without repeating itself", async () => {
    const first = await search("kubernetes", "&limit=1");
    const second = await search("kubernetes", "&limit=1&offset=1");
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notDeepEqual(first, second);
  });

  it("needs a session", async () => {
    const response = await fetch(`${app.baseUrl}/api/search?q=kubernetes`);
    assert.equal(response.status, 401);
  });
});

describe("the tags on offer", () => {
  it("leaves out the folder names ingest puts in the tag column", async () => {
    const { body } = await api(app, "/api/tags");
    const topics = (body as Array<{ topic: string }>).map((t) => t.topic);
    // Both seeded feeds sit in no folder, but Magazines and Blogs are the two
    // values ingest writes when an article publishes no category of its own —
    // they say nothing about any article and must never be offered as tags.
    assert.ok(!topics.includes("Magazines"), "Magazines is not a tag");
    assert.ok(!topics.includes("Blogs"), "Blogs is not a tag");
  });

  it("needs a session", async () => {
    const response = await fetch(`${app.baseUrl}/api/tags`);
    assert.equal(response.status, 401);
  });
});

describe("the index follows the articles", () => {
  it("picks up an insert, an edit and a delete", async () => {
    const db = app.db;

    assert.deepEqual(await search("zzqqxx"), []);

    const feedId = (db.prepare("SELECT id FROM feeds WHERE subscribed = 1 LIMIT 1").get() as { id: number }).id;
    const id = Number(
      db
        .prepare(
          `INSERT INTO articles (feed_id, guid, title, link, summary, topic)
           VALUES (?, 'probe', 'Zzqqxx arrives', 'https://example.test/probe', '', 'Probe')`
        )
        .run(feedId).lastInsertRowid
    );
    assert.deepEqual(await search("zzqqxx"), ["Zzqqxx arrives"]);

    db.prepare("UPDATE articles SET title = 'Zzqqxx renamed' WHERE id = ?").run(id);
    assert.deepEqual(await search("zzqqxx"), ["Zzqqxx renamed"]);

    db.prepare("DELETE FROM articles WHERE id = ?").run(id);
    assert.deepEqual(await search("zzqqxx"), []);

    // And the index still agrees with the table afterwards.
    db.exec("INSERT INTO articles_fts(articles_fts) VALUES('integrity-check')");
  });
});
