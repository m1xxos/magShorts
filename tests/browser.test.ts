// The flows that have actually broken.
//
// Every case here is a bug that shipped or nearly shipped, and every one of
// them escaped for the same reason: it was checked by hand, once, from one
// starting page, in one direction. They are written down so they cannot go
// again.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { startApp, type TestApp } from "./support/app";

let app: TestApp;
let browser: Browser;

before(async () => {
  app = await startApp(3312);
  // The system Chrome, so the suite needs no browser download.
  browser = await chromium.launch({ channel: "chrome" });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  await app?.stop();
});

async function open(width = 1440, height = 900): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 1024,
  });
  await context.addCookies([
    {
      name: "ms_session",
      value: app.cookie.split("=")[1],
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  (page as Page & { failures: string[] }).failures = failures;
  return page;
}

const path = (page: Page) => page.url().replace(app.baseUrl, "");
const results = (page: Page) =>
  page.locator("main a[href*='article=']").count();

async function go(page: Page, to: string): Promise<void> {
  await page.goto(app.baseUrl + to, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

describe("search", () => {
  it("searches again from the results page", async () => {
    // Reported from use: the URL changed and the results did not, because a
    // push to the same route fires no popstate and remounts nothing.
    const page = await open();
    await go(page, "/search?q=zzqqnothing");
    assert.equal(await results(page), 0);

    await page.getByLabel("Search articles").first().fill("kubernetes");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);

    assert.equal(path(page), "/search?q=kubernetes");
    assert.ok((await results(page)) > 0, "results followed the query");
    assert.ok((await page.locator("main h1").innerText()).includes("kubernetes"));
    await page.close();
  });

  it("searches from the header of another page", async () => {
    const page = await open();
    await go(page, "/");
    await page.getByLabel("Search articles").first().fill("kubernetes");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/search**");
    await page.waitForTimeout(1000);
    assert.ok((await results(page)) > 0);
    await page.close();
  });

  it("opens a result and closes back onto the same results", async () => {
    const page = await open();
    await go(page, "/search?q=kubernetes");
    const before = await results(page);
    await page.locator("main a[href*='article=']").first().click();
    await page.waitForTimeout(1200);
    assert.ok(path(page).includes("article="), "the reader is in the URL");

    await page.locator("[role=dialog] button").filter({ hasText: /Back to/ }).first().click();
    await page.waitForTimeout(1200);
    assert.equal(path(page), "/search?q=kubernetes");
    assert.equal(await results(page), before);
    await page.close();
  });

  it("carries the query in a pasted link", async () => {
    const page = await open();
    await go(page, "/search?q=" + encodeURIComponent("железо"));
    assert.ok((await results(page)) > 0);
    assert.equal(
      await page.getByLabel("Search articles").first().inputValue(),
      "железо"
    );
    await page.close();
  });

  it("is reachable with the slash key", async () => {
    const page = await open();
    await go(page, "/");
    await page.keyboard.press("/");
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      "Search articles"
    );
    await page.close();
  });
});

describe("ordering and narrowing the results", () => {
  // The first card's own text, which is where an order is visible.
  const first = (page: Page) =>
    page.locator("main a[href*='article=']").first().innerText();

  it("reorders by date and says so in the address bar", async () => {
    const page = await open();
    await go(page, "/search?q=kubernetes");
    // Relevance leads with the title match; the Russian article matches only
    // through its Kubernetes tag.
    assert.ok((await first(page)).includes("How to scale Kubernetes"));

    await page.getByRole("button", { name: "Newest" }).click();
    await page.waitForTimeout(900);
    assert.equal(path(page), "/search?q=kubernetes&sort=newest");
    assert.ok((await first(page)).includes("Кубернетес"));

    await page.getByRole("button", { name: "Oldest" }).click();
    await page.waitForTimeout(900);
    assert.equal(path(page), "/search?q=kubernetes&sort=oldest");
    assert.ok((await first(page)).includes("quiet week"));

    // Back to the default, and the URL stops carrying what it already means.
    await page.getByRole("button", { name: "Relevance" }).click();
    await page.waitForTimeout(900);
    assert.equal(path(page), "/search?q=kubernetes");
    assert.deepEqual((page as Page & { failures: string[] }).failures, []);
    await page.close();
  });

  it("opens a pasted order without being told twice", async () => {
    const page = await open();
    await go(page, "/search?q=kubernetes&sort=newest");
    assert.ok((await first(page)).includes("Кубернетес"));
    assert.equal(
      await page
        .getByRole("button", { name: "Newest" })
        .getAttribute("aria-pressed"),
      "true"
    );
    await page.close();
  });

  it("narrows to one publication, and the same chip widens again", async () => {
    const page = await open();
    await go(page, "/search?q=kubernetes");
    assert.equal(await results(page), 3);

    const chip = page.getByRole("button", { name: /^Habr/ });
    await chip.click();
    await page.waitForTimeout(900);
    assert.ok(path(page).startsWith("/search?q=kubernetes&feed="));
    assert.equal(await results(page), 1);
    assert.ok((await first(page)).includes("Кубернетес"));
    // The publications it did not narrow to are still offered — a filter that
    // deletes every other option can only be undone by pressing it again.
    await page.getByRole("button", { name: /^The Verge/ }).waitFor();

    await chip.click();
    await page.waitForTimeout(900);
    assert.equal(path(page), "/search?q=kubernetes");
    assert.equal(await results(page), 3);
    await page.close();
  });

  it("keeps the order but drops the publication on a new search", async () => {
    // The order is how this reader likes to look at results. The publication
    // was picked out of one search's own sources and means nothing in the next.
    const page = await open();
    await go(page, "/search?q=kubernetes&sort=newest");
    await page.getByRole("button", { name: /^Habr/ }).click();
    await page.waitForTimeout(900);

    const box = page.getByRole("textbox", { name: "Search articles" }).first();
    await box.fill("python");
    await box.press("Enter");
    await page.waitForTimeout(1200);
    assert.equal(path(page), "/search?q=python&sort=newest");
    assert.equal(await results(page), 2);
    await page.close();
  });

  it("does not count a publication the search never found", async () => {
    // A ?feed= naming a publication this search found nothing in — a URL
    // somebody can type, and what a link becomes once the publication is
    // unsubscribed. The count belongs to the whole search, and printing it
    // here read "3 in your subscriptions" directly above "Nothing matched".
    const page = await open();
    await go(page, "/search?q=kubernetes&feed=99999");
    assert.equal(await results(page), 0);
    const line = await page.locator("main p").first().innerText();
    assert.match(line, /^0 in your subscriptions/);
    await page.close();
  });

  it("offers no order for a search that found one thing", async () => {
    const page = await open();
    await go(page, "/search?q=" + encodeURIComponent("tag:Machine Learning"));
    assert.equal(await results(page), 1);
    assert.equal(
      await page.getByRole("button", { name: "Newest" }).count(),
      0,
      "three buttons that reorder a single card are a distinction without a difference"
    );
    await page.close();
  });
});

describe("tags", () => {
  it("searches a tag from the pill on a card", async () => {
    // Typing "tag:" is not a thing anyone should have to know.
    const page = await open();
    await go(page, "/?view=all");
    await page.locator("main button", { hasText: "Kubernetes" }).first().click();
    await page.waitForURL("**/search**");
    await page.waitForTimeout(1200);
    assert.equal(path(page), "/search?q=" + encodeURIComponent("tag:Kubernetes"));
    assert.ok((await results(page)) > 0);
    await page.close();
  });

  it("searches a tag from a chip, and the chip clears it", async () => {
    const page = await open();
    await go(page, "/search");
    const chip = page.getByRole("button", { name: /^Python/ }).first();
    await chip.click();
    await page.waitForTimeout(1200);
    assert.equal(path(page), "/search?q=" + encodeURIComponent("tag:Python"));
    assert.equal(await results(page), 2);
    assert.equal(await chip.getAttribute("aria-pressed"), "true");

    await chip.click();
    await page.waitForTimeout(900);
    assert.equal(path(page), "/search");
    assert.equal(await results(page), 0, "back to nothing searched");
    await page.close();
  });

  it("offers no tag chips over a typed search", async () => {
    // A tag chip *replaces* the query rather than narrowing it, so over the
    // results of something you typed it is a row of buttons that throw away
    // what you came here with. The publications underneath narrow instead.
    const page = await open();
    await go(page, "/search?q=kubernetes");
    assert.equal(
      await page.getByRole("button", { name: /^Python/ }).count(),
      0
    );
    await go(page, "/search");
    assert.ok((await page.getByRole("button", { name: /^Python/ }).count()) > 0);
    await page.close();
  });

  it("lights the right chip for a pasted tag link", async () => {
    const page = await open();
    await go(page, "/search?q=" + encodeURIComponent("tag:python"));
    const chip = page.getByRole("button", { name: /^Python/ }).first();
    assert.equal(await chip.getAttribute("aria-pressed"), "true");
    await page.close();
  });
});

describe("the search box", () => {
  it("clears back to nothing searched when emptied", async () => {
    const page = await open();
    await go(page, "/search?q=kubernetes");
    assert.ok((await results(page)) > 0);
    await page.getByLabel("Search articles").first().fill("");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    assert.equal(path(page), "/search");
    assert.equal(await results(page), 0);
    await page.close();
  });

  it("is not focused by slash while the reader covers it", async () => {
    // Focusing a field under the overlay means typing into something nobody
    // can see, and Enter then changes the results behind the article.
    const page = await open();
    await go(page, "/?view=all");
    await page.locator("main a[href*='article=']").first().click();
    await page.waitForTimeout(1200);
    const before = path(page);
    await page.keyboard.press("/");
    await page.waitForTimeout(300);
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      "Search articles"
    );
    assert.equal(path(page), before, "and nothing navigated");
    await page.close();
  });
});

describe("the list you are looking at", () => {
  it("is named in the address bar, and Back walks the lists", async () => {
    // Picking a feed used to change React state and nothing else: leaving and
    // coming back lost it, and Back left the site.
    const page = await open();
    await go(page, "/");
    const seen: string[] = [];
    for (const label of ["For you", "All publications"]) {
      await page.locator("aside button").filter({ hasText: label }).first().click();
      await page.waitForTimeout(500);
      seen.push(path(page));
    }
    assert.deepEqual(seen, ["/?view=forYou", "/?view=all"]);

    await page.goBack();
    await page.waitForTimeout(600);
    assert.equal(path(page), "/?view=forYou");
    await page.close();
  });

  it("survives a trip to another page", async () => {
    const page = await open();
    await go(page, "/");
    await page.locator("aside button").filter({ hasText: "For you" }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("link", { name: "Read later" }).first().click();
    await page.waitForURL("**/reading-list");
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(800);
    assert.equal(path(page), "/?view=forYou");
    await page.close();
  });
});

describe("the reader", () => {
  it("walks back through the articles it was given", async () => {
    const page = await open();
    await go(page, "/?view=all");
    await page.locator("main a[href*='article=']").first().click();
    await page.waitForTimeout(1200);
    const first = path(page);

    const depth = () =>
      page.evaluate(() => (window.history.state as { msReaderDepth?: number })?.msReaderDepth ?? 0);
    assert.equal(await depth(), 1);

    await page.goBack();
    await page.waitForTimeout(900);
    assert.notEqual(path(page), first);
    assert.equal(await page.locator("[role=dialog][aria-modal=true]").count(), 0);
    await page.close();
  });

  it("does not walk off the site when Escape is held down", async () => {
    const page = await open();
    await go(page, "/?view=all");
    await page.locator("main a[href*='article=']").first().click();
    await page.waitForTimeout(1200);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1200);
    assert.ok(path(page).startsWith("/?view=all"), `still on the list, got ${path(page)}`);
    await page.close();
  });
});

describe("keeping a passage with a finger", () => {
  // An iPad selects by long-press and is then adjusted by dragging the two
  // handles. The reader used to wrap the passage in a <mark> the instant it
  // saw a selection, and splitting the text nodes under a live selection makes
  // WebKit drop it — handles and all. Every long-press gave you one word and
  // no way to grow it, which is what "selecting text on an iPad is horrible"
  // actually was.
  const PROSE =
    "<p>Kubernetes schedules containers across a fleet of machines, " +
    "and the scheduler is the part nobody reads about until it goes wrong.</p>" +
    "<p>A second paragraph, so the body is not one node.</p>";

  // Its own body text, written before each case rather than once: these run
  // in the same database as everything else, and a test that leans on a
  // fixture another test happened to write is a test that passes in order and
  // fails alone.
  async function reader(width: number, height: number): Promise<Page> {
    const article = app.articles[0];
    app.db
      .prepare(
        `INSERT INTO article_content (article_id, html, text, headings, reading_minutes, status, source)
         VALUES (?, ?, ?, '[]', 2, 'ok', 'direct')
         ON CONFLICT(article_id) DO UPDATE SET html = excluded.html, status = 'ok'`
      )
      .run(article.id, PROSE, PROSE.replace(/<[^>]+>/g, " "));
    const page = await open(width, height);
    await go(page, `/?view=all&article=${article.id}`);
    await page.locator(".reader-body p").first().waitFor();
    return page;
  }

  async function readerOnAnIpad(): Promise<Page> {
    const page = await reader(834, 1112);
    assert.ok(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "the context really is a touch screen"
    );
    return page;
  }

  // Everything actually kept, as opposed to the shade the reader paints over
  // a passage it is only offering to keep.
  const kept = (page: Page) =>
    page.locator('.reader-body mark[data-hl]:not([data-hl="-1"])');

  // The finger is gone by the time iOS has made the selection, so the reader
  // has only selectionchange and touchend to go on. Both are exercised.
  const select = (page: Page, from: number, to: number) =>
    page.evaluate(
      ([from_, to_]) => {
        const node = document.querySelector(".reader-body p")!.firstChild!;
        const range = document.createRange();
        range.setStart(node, from_);
        range.setEnd(node, to_);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("touchend"));
      },
      [from, to]
    );

  const selected = (page: Page) =>
    page.evaluate(() => getSelection()?.toString() ?? "");

  it("leaves the selection alone so its handles can still be dragged", async () => {
    const page = await readerOnAnIpad();
    await select(page, 0, 10);
    await page.getByRole("button", { name: "Highlight" }).waitFor();

    // The whole bug in one assertion: the bar is up and the selection is
    // still there to adjust.
    assert.equal(await selected(page), "Kubernetes");

    // Dragging a handle out to the end of the clause. No touchend: iOS ends a
    // handle drag without one, and selectionchange is the only signal.
    await page.evaluate(() => {
      const node = document.querySelector(".reader-body p")!.firstChild!;
      getSelection()!.extend(node, 20);
    });
    await page.waitForTimeout(700);
    assert.equal(await selected(page), "Kubernetes schedules");
    assert.equal(
      await page.getByRole("button", { name: "Highlight" }).count(),
      1,
      "the bar followed the selection rather than dying with it"
    );

    await page.getByRole("button", { name: "Highlight" }).click();
    await page.waitForTimeout(900);
    const quote = app.db
      .prepare("SELECT quote FROM highlights ORDER BY id DESC LIMIT 1")
      .get() as { quote: string } | undefined;
    assert.equal(quote?.quote, "Kubernetes schedules", "kept what was selected");
    assert.equal(await kept(page).first().innerText(), "Kubernetes schedules");
    app.db.exec("DELETE FROM highlights");
    await page.close();
  });

  it("still works the way a mouse expects", async () => {
    // The finger fix moved when the passage gets painted and when the bar is
    // allowed to close. Both of those are shared with the mouse.
    const page = await reader(1440, 900);

    await page.evaluate(() => {
      const node = document.querySelector(".reader-body p")!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 10);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Highlight" }).waitFor();
    // On a mouse the gesture is over, so the passage is marked at once.
    assert.equal(
      await page.locator('.reader-body mark[data-hl="-1"]').innerText(),
      "Kubernetes"
    );

    await page.getByRole("button", { name: "Highlight" }).click();
    await page.waitForTimeout(900);
    const quote = app.db
      .prepare("SELECT quote FROM highlights ORDER BY id DESC LIMIT 1")
      .get() as { quote: string } | undefined;
    assert.equal(quote?.quote, "Kubernetes");

    // And clicking the passage again offers to take it back.
    await kept(page).first().click();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole("button", { name: "Remove" }).count(), 1);
    // A click anywhere else puts the bar away.
    await page.locator(".reader-body p").last().click();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole("button", { name: "Remove" }).count(), 0);

    app.db.exec("DELETE FROM highlights");
    await page.close();
  });

  it("lets a mouse dismiss a bar over a selection that did not start a node", async () => {
    // Marking a passage splits the text nodes under it, and what that leaves
    // of the selection depends on where it began: a selection starting at
    // offset 0 collapses, one starting mid-node does not, and one spanning two
    // paragraphs comes through with text still in it. A dismissal rule that
    // asked "is anything selected?" therefore worked for the first and left
    // the bar unclosable for the other two.
    const page = await reader(1440, 900);
    await page.evaluate(() => {
      const node = document.querySelector(".reader-body p")!.firstChild!;
      const range = document.createRange();
      range.setStart(node, 11);
      range.setEnd(node, 31);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Highlight" }).waitFor();
    assert.equal(
      await page.locator('.reader-body mark[data-hl="-1"]').innerText(),
      "schedules containers"
    );

    await page.locator(".reader-body p").last().click();
    await page.waitForTimeout(500);
    assert.equal(await page.getByRole("button", { name: "Highlight" }).count(), 0);
    assert.equal(
      await page.locator('.reader-body mark[data-hl="-1"]').count(),
      0,
      "and the shade went with it"
    );
    await page.close();
  });

  it("keeps the bar through a handle passing over the other one", async () => {
    // Dragging one handle onto the other collapses the selection for an
    // instant on the way. That instant is not the end of the drag, and a bar
    // that took it for one would disappear in the middle of being aimed.
    const page = await readerOnAnIpad();
    await select(page, 0, 10);
    await page.getByRole("button", { name: "Highlight" }).waitFor();

    // Watched while it happens, not after: the bar losing its nerve and
    // coming back is invisible to anything that only looks at the end.
    const seen: boolean[] = await page.evaluate(async () => {
      const node = document.querySelector(".reader-body p")!.firstChild!;
      const samples: boolean[] = [];
      getSelection()!.collapseToStart();
      await new Promise((done) => setTimeout(done, 120));
      getSelection()!.extend(node, 20);
      for (let at = 0; at < 14; at++) {
        await new Promise((done) => setTimeout(done, 50));
        samples.push(
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent === "Highlight"
          )
        );
      }
      return samples;
    });
    assert.ok(
      seen.every(Boolean),
      `the bar stayed up for the whole drag, saw ${JSON.stringify(seen)}`
    );
    assert.equal(await selected(page), "Kubernetes schedules");
    await page.close();
  });

  it("waits for a slow tap on its own button", async () => {
    // iOS takes the selection away on the touchstart of the tap and dispatches
    // the click afterwards. A press held a beat too long used to outlast the
    // bar, and the button it was pressing went with it.
    const page = await readerOnAnIpad();
    await select(page, 0, 10);
    await page.getByRole("button", { name: "Highlight" }).waitFor();

    await page.evaluate(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      getSelection()!.removeAllRanges();
    });
    await page.waitForTimeout(800);
    assert.equal(
      await page.getByRole("button", { name: "Highlight" }).count(),
      1,
      "the bar is still under the finger that is pressing it"
    );

    await page.evaluate(() =>
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    );
    await page.getByRole("button", { name: "Highlight" }).click();
    await page.waitForTimeout(900);
    const quote = app.db
      .prepare("SELECT quote FROM highlights ORDER BY id DESC LIMIT 1")
      .get() as { quote: string } | undefined;
    assert.equal(quote?.quote, "Kubernetes");
    app.db.exec("DELETE FROM highlights");
    await page.close();
  });

  it("moves the shade to the passage actually chosen", async () => {
    // A second selection supersedes the first. The shade used to be painted
    // only when there was none on the page at all, so the first passage went
    // on looking chosen and Highlight would save the second one under it.
    const page = await reader(1440, 900);
    const choose = (at: number, from: number, to: number) =>
      page.evaluate(
        ([at_, from_, to_]) => {
          const node =
            document.querySelectorAll(".reader-body p")[at_].firstChild!;
          const range = document.createRange();
          range.setStart(node, from_);
          range.setEnd(node, to_);
          const selection = getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        },
        [at, from, to]
      );

    await choose(0, 0, 10);
    await page.getByRole("button", { name: "Highlight" }).waitFor();
    // In the other paragraph: marking the first passage split the text node
    // the first one was made from, and offsets into it no longer mean
    // anything.
    await choose(1, 2, 8);
    await page.waitForTimeout(400);

    const shade = page.locator('.reader-body mark[data-hl="-1"]');
    assert.equal(await shade.count(), 1, "one passage is offered, not two");
    assert.equal(await shade.innerText(), "second");

    await page.getByRole("button", { name: "Highlight" }).click();
    await page.waitForTimeout(900);
    const quote = app.db
      .prepare("SELECT quote FROM highlights ORDER BY id DESC LIMIT 1")
      .get() as { quote: string } | undefined;
    assert.equal(quote?.quote, "second", "and that is what was kept");
    app.db.exec("DELETE FROM highlights");
    await page.close();
  });

  it("takes the bar away when the selection is tapped away", async () => {
    const page = await readerOnAnIpad();
    await select(page, 0, 10);
    await page.getByRole("button", { name: "Highlight" }).waitFor();

    // A tap somewhere else in the prose: the selection collapses and nothing
    // else happens. Nothing is left pointing at a passage that is no longer
    // chosen.
    await page.evaluate(() => getSelection()!.collapseToEnd());
    await page.waitForTimeout(700);
    assert.equal(await page.getByRole("button", { name: "Highlight" }).count(), 0);
    assert.equal(
      await page.locator(".reader-body mark[data-hl]").count(),
      0,
      "and no half-drawn highlight left behind"
    );
    await page.close();
  });
});

describe("the menu on a narrow screen", () => {
  it("reaches every destination and closes on a tap that does not navigate", async () => {
    // Below lg the rail is not rendered, and for a long time nothing replaced
    // it. Then the sheet was added and never closed, because onNavigate was
    // never passed to it.
    const page = await open(834, 1100);
    await go(page, "/");
    await page.getByRole("button", { name: "Open the menu" }).click();
    await page.waitForTimeout(400);

    const text = await page.locator("[role=dialog]").innerText();
    for (const label of ["Search", "Digest", "Read later", "Discover", "Your reading", "Settings"]) {
      assert.ok(text.includes(label), `${label} is in the menu`);
    }

    // A feed row changes the grid without changing the route.
    await page.locator("[role=dialog] button").filter({ hasText: "For you" }).first().click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator("[role=dialog]").count(), 0, "the sheet closed");
    await page.close();
  });
});
