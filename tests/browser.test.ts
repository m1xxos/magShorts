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

  it("lights the right chip for a pasted tag link", async () => {
    const page = await open();
    await go(page, "/search?q=" + encodeURIComponent("tag:python"));
    const chip = page.getByRole("button", { name: /^Python/ }).first();
    assert.equal(await chip.getAttribute("aria-pressed"), "true");
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
