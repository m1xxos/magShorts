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

  it("searches tags when asked", async () => {
    assert.deepEqual(await search("tag:python"), ["Пишем на Python"]);
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
