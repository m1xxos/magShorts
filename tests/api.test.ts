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
