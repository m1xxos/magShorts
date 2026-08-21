import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { getDb } from "./db";
import { fetchPageHtml } from "./articleImages";
import { bodyFromEmbeddedState } from "./embeddedState";
import {
  archiveBases,
  getSetting,
  isArchiveDomain,
  isDirectDomain,
} from "./settings";
import {
  type ArticleContentDto,
  type ExtractSource,
  type ReaderHeading,
} from "./types";

// Full-text extraction for the in-app reader.
//
// Lazy by construction: nothing in here runs on a list render, a scroll or a
// hover. There are exactly two callers — opening the reader and saving to Read
// later — and the first thing both hit is the cache. A second open of the same
// article costs one indexed SELECT and no outbound request.
//
// The parser is @mozilla/readability over a linkedom DOM. That was measured
// rather than assumed: see docs/extraction-bench.md, where the regex strip the
// digest uses returns 99 characters of The Atlantic and Readability returns
// 2 448 across 26 paragraphs.

// Below this, a body is a teaser and the chain should keep going. RSS excerpts
// commonly run 300–800 characters, so the floor sits above them.
const ENOUGH = 1200;
// Under this there is no article to show. Ingest uses the same figure to
// decide a feed body is "just the summary again" (CONTENT_MAX_LENGTH's
// neighbour in rss.ts), and a reading column holding 80 characters and calling
// itself the article is worse than an honest failure with a Retry button.
const MIN_USEFUL = 400;
// Phrases publishers put where the rest of the article should be. Matched
// case-insensitively against the extracted text, English and Russian, because
// a 4 000-character page can still be 90% paywall.
const PAYWALL_MARKERS = [
  "subscribe to continue",
  "already a subscriber",
  "to continue reading",
  "continue reading this article",
  "this article is for subscribers",
  "sign in to read",
  "become a member",
  "create a free account to",
  "чтобы продолжить чтение",
  "только для подписчиков",
];
// A hop only wins if it beats what we already have by a real margin — 5% more
// of the same boilerplate is not a better article.
const BETTER_BY = 1.15;
const WORDS_PER_MINUTE = 200;
// Bodies are stored, so they need a ceiling. 200 KB is roughly a 30 000-word
// piece; nothing in the corpus came close.
const HTML_MAX = 200_000;
const TEXT_MAX = 120_000;
// Failed extractions are cached, and re-tried only when the reader explicitly
// asks (the Retry button) or after this many attempts have not yet been spent.
const MAX_ATTEMPTS = 3;
// The reader is waiting on this, so the chain gets a budget rather than the
// sum of its parts. Marreta has been measured at 3–20 s per request; without a
// ceiling three hops could keep a spinner on screen for a minute.
const HOP_TIMEOUT_MS = 12_000;
// A client-rendered page is mostly its state blob: WIRED serves 1.1 MB, of
// which 520 KB is the JSON the article lives in. The cover backfill's 500 KB
// ceiling would cut that blob in half and leave it unparseable.
const PAGE_BYTES = 4_000_000;
const CHAIN_BUDGET_MS = 30_000;

interface StoredRow {
  article_id: number;
  html: string | null;
  text: string | null;
  headings: string | null;
  reading_minutes: number | null;
  status: string;
  source: string | null;
  attempts: number;
  extracted_at: string;
}

function toDto(row: StoredRow): ArticleContentDto {
  return {
    article_id: row.article_id,
    status: row.status === "ok" ? "ok" : "failed",
    html: row.html,
    headings: row.headings ? (JSON.parse(row.headings) as ReaderHeading[]) : [],
    reading_minutes: row.reading_minutes,
    source: (row.source as ExtractSource | null) ?? null,
    extracted_at: row.extracted_at,
  };
}

// The cached row, or null. Never fetches — this is what GET serves.
export function readContent(articleId: number): ArticleContentDto | null {
  const row = getDb()
    .prepare("SELECT * FROM article_content WHERE article_id = ?")
    .get(articleId) as StoredRow | undefined;
  return row ? toDto(row) : null;
}

// ------------------------------------------------------------- sanitising

// Everything a reading column legitimately needs, and nothing that can execute,
// navigate on its own, or phone home.
const ALLOWED = new Set([
  "p", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "figure", "figcaption",
  "img", "a", "em", "i", "strong", "b", "code", "pre",
  "br", "hr", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub",
]);

// Dropped with their contents. Everything else that isn't allowed is unwrapped
// instead — a <div> around three paragraphs should lose the div, not the
// paragraphs.
const DISCARD = new Set([
  "script", "style", "noscript", "svg", "iframe", "object", "embed",
  "form", "input", "button", "select", "textarea", "video", "audio",
  "canvas", "link", "meta",
]);

// Publishers mark a slideshow on a container, and Readability throws the
// container away — so the images are tagged before it runs and regrouped
// after. The attribute is the only thing that survives the round trip.
const GALLERY_ATTR = "data-ms-gallery";

const ATTRS: Record<string, string[]> = {
  a: ["href"],
  // width and height are kept when the page states them: the browser can then
  // reserve the space before the picture loads, and a long article stops
  // shifting under the reader as its images arrive.
  img: ["src", "alt", "width", "height", GALLERY_ATTR],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
};

// Containers that say, in the page's own markup, that these images are one
// slideshow. No guessing from layout: three illustrations in a row are an
// illustrated article, not a carousel, and turning one into the other would be
// worse than leaving it alone.
const GALLERY_SELECTOR = [
  '[aria-roledescription="carousel"]',
  '[aria-label*="carousel" i]',
  '[aria-label*="gallery" i]',
  '[aria-label*="slideshow" i]',
  '[class*="gallery" i]',
  '[class*="carousel" i]',
  '[class*="slideshow" i]',
  "figure",
].join(",");

// Reserve the space a picture will take, before it takes it. An <img> with no
// stated size is a hole the browser can only measure once the file arrives, so
// a long article rearranges itself under the reader as it scrolls. Pages state
// the size in more than one place and almost never in the attributes, so take
// it wherever it is: the attributes, the PhotoSwipe data the lightbox scripts
// use, or an inline aspect-ratio on a wrapper.
export function statePictureSizes(document: Document): void {
  for (const image of document.querySelectorAll("img")) {
    if (/^\d+$/.test(image.getAttribute("width") ?? "") &&
        /^\d+$/.test(image.getAttribute("height") ?? "")) {
      continue;
    }
    const ratio = statedRatio(image);
    if (!ratio || !Number.isFinite(ratio) || ratio <= 0) continue;
    // Any pair with the right ratio will do — the browser scales to the
    // column and only uses these two numbers to reserve the box.
    image.setAttribute("width", "1000");
    image.setAttribute("height", String(Math.round(1000 / ratio)));
  }
}

function statedRatio(image: Element): number | null {
  const pswpHost = image.closest("[data-pswp-width]") ?? image;
  const w = Number(pswpHost.getAttribute("data-pswp-width"));
  const h = Number(pswpHost.getAttribute("data-pswp-height"));
  if (w > 0 && h > 0) return w / h;

  const width = Number(image.getAttribute("width"));
  const height = Number(image.getAttribute("height"));
  if (width > 0 && height > 0) return width / height;

  for (let node: Element | null = image; node; node = node.parentElement) {
    const stated = node.getAttribute("style") ?? "";
    const match = stated.match(/aspect-ratio\s*:\s*([\d.]+)(?:\s*\/\s*([\d.]+))?/i);
    if (match) {
      const a = Number(match[1]);
      const b = match[2] ? Number(match[2]) : 1;
      if (a > 0 && b > 0) return a / b;
    }
    if (node.tagName === "ARTICLE" || node.tagName === "BODY") break;
  }
  return null;
}

export function markGalleries(document: Document): void {
  let group = 0;
  for (const node of document.querySelectorAll(GALLERY_SELECTOR)) {
    const images = node.querySelectorAll("img");
    // One image is a picture. Already-tagged images belong to the innermost
    // container that claimed them, which is the more specific answer.
    if (images.length < 2) continue;
    if ([...images].every((image) => image.hasAttribute(GALLERY_ATTR))) continue;
    group++;
    for (const image of images) image.setAttribute(GALLERY_ATTR, String(group));
  }
}

const COMMENT_NODE = 8;

function dropComments(node: Node): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === COMMENT_NODE) child.remove();
    else if (child.hasChildNodes()) dropComments(child);
  }
}

function slug(text: string, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base ? `s-${index}-${base}` : `s-${index}`;
}

function absolute(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

interface Sanitised {
  html: string;
  text: string;
  headings: ReaderHeading[];
}

// Walk the parsed body, keep the allowlist, and collect the outline on the way
// through. Readability's output is not safe for dangerouslySetInnerHTML — it
// preserves whatever inline handlers and embeds the page had — and doing the
// heading ids in the same pass means the outline can never disagree with the
// body it points at.
export function sanitizeArticleHtml(bodyHtml: string, baseUrl: string): Sanitised {
  const { document } = parseHTML(`<html><body>${bodyHtml}</body></html>`);
  const headings: ReaderHeading[] = [];

  function walk(node: Element): void {
    // Snapshot: the loop reparents children as it goes.
    for (const child of [...node.children]) walk(child as Element);

    const tag = node.tagName.toLowerCase();
    if (DISCARD.has(tag)) {
      node.remove();
      return;
    }
    if (!ALLOWED.has(tag)) {
      // Unwrap: keep the children, lose the wrapper.
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      return;
    }

    const keep = ATTRS[tag] ?? [];
    for (const attr of [...node.attributes].map((a) => a.name)) {
      if (!keep.includes(attr)) node.removeAttribute(attr);
    }

    if (tag === "a") {
      const href = node.getAttribute("href");
      const resolved = href ? absolute(href, baseUrl) : null;
      if (!resolved) {
        node.removeAttribute("href");
      } else {
        node.setAttribute("href", resolved);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }

    if (tag === "img") {
      for (const side of ["width", "height"]) {
        const stated = node.getAttribute(side) ?? "";
        if (!/^\d+$/.test(stated)) node.removeAttribute(side);
      }
      const src = node.getAttribute("src");
      const resolved = src ? absolute(src, baseUrl) : null;
      if (!resolved) {
        node.remove();
        return;
      }
      // Through the local cache, like every other image in the app: the
      // reader should not hand the publisher a request per illustration.
      node.setAttribute("src", `/api/images?u=${encodeURIComponent(resolved)}`);
      node.setAttribute("loading", "lazy");
    }

    if (/^h[2-6]$/.test(tag)) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) {
        const id = slug(text, headings.length);
        node.setAttribute("id", id);
        headings.push({ id, text, level: Number(tag[1]) });
      }
    }
  }

  // Readability leaves the headline as an <h1>; the reader draws that itself.
  for (const h1 of [...document.querySelectorAll("h1")]) h1.remove();

  // Comments are inert in a browser but they are not free: the walk below
  // only sees elements, so a commented-out template — Octopus ships one at the
  // foot of every post — would otherwise be stored with the article forever.
  dropComments(document.body);

  for (const child of [...document.body.children]) walk(child as Element);

  collectGalleries(document as unknown as Document);

  // An <img> or <br> alone in a paragraph is fine; an empty one is a gap.
  for (const p of [...document.querySelectorAll("p, li, figcaption")]) {
    if (!(p.textContent ?? "").trim() && p.children.length === 0) p.remove();
  }

  return {
    html: document.body.innerHTML.slice(0, HTML_MAX),
    text: (document.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX),
    headings,
  };
}

// Put the slideshow back together. Readability leaves the images as loose
// siblings, each usually wrapped in the link to its full-size version, so this
// walks the tagged ones in document order, lifts them out of whatever they are
// sitting in, and drops one gallery block where the first of them was.
//
// The markup is deliberately inert: a track of figures that already scrolls
// horizontally on its own. Reader.tsx adds arrows, a counter and a caption
// line on top, and if that never runs you still get the pictures.
function collectGalleries(document: Document): void {
  const groups = new Map<string, Element[]>();
  for (const image of document.querySelectorAll(`img[${GALLERY_ATTR}]`)) {
    const id = image.getAttribute(GALLERY_ATTR) ?? "";
    image.removeAttribute(GALLERY_ATTR);
    const bucket = groups.get(id) ?? [];
    bucket.push(image);
    groups.set(id, bucket);
  }

  for (const images of groups.values()) {
    // Readability may have dropped all but one of them, and one image is not
    // a carousel — leave it where it is.
    if (images.length < 2) continue;
    const anchorBlock = topLevelAncestor(document, images[0]);
    if (!anchorBlock) continue;

    const gallery = document.createElement("div");
    gallery.setAttribute("class", "reader-gallery");
    gallery.setAttribute("data-count", String(images.length));
    const track = document.createElement("div");
    track.setAttribute("class", "reader-gallery-track");
    gallery.appendChild(track);

    const emptied = new Set<Element>();
    for (const image of images) {
      const block = topLevelAncestor(document, image);
      if (block) emptied.add(block);
      const slide = document.createElement("figure");
      // The caption the publisher wrote lives in alt, markup and all.
      const caption = plainText(image.getAttribute("alt") ?? "");
      image.removeAttribute("alt");
      // Slides are usually wrapped in a link to the full-size file. The link
      // itself goes — inside a carousel it is a trap, not a control — but the
      // address is what the lightbox should show, so it rides along.
      const full = image.parentElement?.closest("a")?.getAttribute("href");
      if (full) image.setAttribute("data-full", full);
      slide.appendChild(image);
      if (caption) {
        const figcaption = document.createElement("figcaption");
        figcaption.textContent = caption;
        slide.appendChild(figcaption);
      }
      track.appendChild(slide);
    }

    anchorBlock.parentNode?.insertBefore(gallery, anchorBlock);
    // The paragraphs and links the images were pulled out of have nothing
    // left in them but the whitespace between the images.
    for (const block of emptied) {
      if (!(block.textContent ?? "").trim() && block.querySelectorAll("img").length === 0) {
        block.remove();
      }
    }
    dropGalleryChrome(gallery, images.length);
  }
}

// A slideshow renders its own furniture — The Verge writes out "1/4" and the
// caption of whichever slide is showing — and once the container is gone that
// furniture is left standing in the prose as a stray "1/4" under the pictures.
// Only what immediately follows the gallery is considered, and the scan stops
// at the first block that is neither a counter nor a caption we already show,
// so nothing further down the article is at risk.
function dropGalleryChrome(gallery: Element, slideCount: number): void {
  const captions = new Set(
    [...gallery.querySelectorAll("figcaption")].map((node) =>
      normalise(node.textContent ?? "")
    )
  );
  const isChrome = (text: string) =>
    text === "" || COUNTER.test(text) || captions.has(text);

  let node = gallery.nextElementSibling;
  let budget = slideCount + 2;
  while (node && budget-- > 0) {
    const next = node.nextElementSibling;
    if (node.querySelectorAll("img").length > 0) break;
    // The counter and the caption often share one paragraph, so the pieces
    // are taken out individually before the block is judged.
    for (const part of [...node.querySelectorAll("figcaption, strong, b, span, em")]) {
      if (isChrome(normalise(part.textContent ?? ""))) part.remove();
    }
    if (!isChrome(normalise(node.textContent ?? ""))) break;
    node.remove();
    node = next;
  }
}

const COUNTER = /^\d+\s*\/\s*\d+$/;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// The child of <body> that this node sits under, which is the level a gallery
// replaces.
function topLevelAncestor(document: Document, node: Element): Element | null {
  let current: Element | null = node;
  while (current && current.parentElement && current.parentElement !== document.body) {
    current = current.parentElement;
  }
  return current?.parentElement === document.body ? current : null;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- parsing

function parseArticle(rawHtml: string, url: string): Sanitised | null {
  try {
    const { document } = parseHTML(rawHtml);
    // Readability absolutises against the document's base.
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.appendChild(base);
    statePictureSizes(document as unknown as Document);
    markGalleries(document as unknown as Document);
    // linkedom's Document is structurally what Readability wants; the two
    // packages simply don't share type declarations.
    const parsed = new Readability(document as unknown as Document).parse();
    if (!parsed?.content) return null;
    const clean = sanitizeArticleHtml(parsed.content, url);
    return clean.text.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

// The article a page shipped as data rather than as markup. Costs no request:
// it reads the HTML already in hand, which is why it sits between the direct
// parse and the first unlock service.
function parseEmbedded(
  rawHtml: string,
  url: string
): { clean: Sanitised; structured: boolean } | null {
  const found = bodyFromEmbeddedState(rawHtml);
  if (!found) return null;
  const clean = sanitizeArticleHtml(found.html, url);
  if (clean.text.length === 0) return null;
  console.log(
    `[extract] embedded state at ${found.path} — ${clean.text.length} chars` +
      (found.structured ? "" : " (flattened)")
  );
  return { clean, structured: found.structured };
}

// --------------------------------------------------------- the unlock chain

// Full-text variants the page itself advertises. Not impersonation: these are
// URLs the publisher published, and a print or AMP rendering is routinely the
// whole article where the main template shows a teaser.
function alternateUrls(rawHtml: string, url: string): string[] {
  const candidates: string[] = [];
  const amp = rawHtml.match(
    /<link\b[^>]*rel=["']?amphtml["']?[^>]*href=["']([^"']+)["']/i
  )?.[1] ??
    rawHtml.match(
      /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']?amphtml["']?/i
    )?.[1];
  if (amp) {
    const resolved = absolute(amp, url);
    if (resolved) candidates.push(resolved);
  }
  try {
    const print = new URL(url);
    print.searchParams.set("print", "1");
    candidates.push(print.toString());
  } catch {
    // A malformed link has nothing to offer here.
  }
  return candidates;
}

function marretaUrl(link: string): string | null {
  const base = getSetting("marreta_url").replace(/\/+$/, "");
  if (!base || isDirectDomain(link)) return null;
  return `${base}/p/${link}`;
}

function archiveHops(link: string): Hop[] {
  return archiveBases().map((base) => ({
    source: "archive" as const,
    url: `${base}/${link}`,
  }));
}

interface Hop {
  source: ExtractSource;
  url: string;
}

// Direct first, then what the page itself offers, then the unlock services the
// app is already configured with — src/app/api/unlock/route.ts sends the
// open-in-a-tab path through the same settings. Domains listed in
// archive_domains put the archives first, because Marreta cannot fetch them.
function hops(link: string, pageHtml: string | null): Hop[] {
  const list: Hop[] = [];
  const archives = archiveHops(link);
  const marreta = marretaUrl(link);
  if (pageHtml) {
    for (const url of alternateUrls(pageHtml, link)) {
      list.push({ source: "amp", url });
    }
  }
  if (isArchiveDomain(link)) {
    list.push(...archives);
    if (marreta) list.push({ source: "marreta", url: marreta });
  } else {
    if (marreta) list.push({ source: "marreta", url: marreta });
    list.push(...archives);
  }
  return list;
}

// ------------------------------------------------------------- extraction

function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

interface Attempt {
  clean: Sanitised;
  source: ExtractSource;
}

// One extraction in flight per article: a double click, or an open that races
// the save that triggered it, is one fetch and one write.
const inFlight = new Map<number, Promise<ArticleContentDto>>();

export async function extractArticle(
  articleId: number,
  options: { force?: boolean } = {}
): Promise<ArticleContentDto> {
  const cached = readContent(articleId);
  if (cached && !options.force) {
    if (cached.status === "ok") return cached;
    const attempts = (
      getDb()
        .prepare("SELECT attempts FROM article_content WHERE article_id = ?")
        .get(articleId) as { attempts: number } | undefined
    )?.attempts ?? 0;
    // A link that has failed this often is not going to answer on the next
    // grid render either. The reader's Retry passes force.
    if (attempts >= MAX_ATTEMPTS) return cached;
  }

  const running = inFlight.get(articleId);
  if (running) return running;

  const task = run(articleId).finally(() => inFlight.delete(articleId));
  inFlight.set(articleId, task);
  return task;
}

async function run(articleId: number): Promise<ArticleContentDto> {
  const db = getDb();
  const article = db
    .prepare("SELECT id, link, content, summary FROM articles WHERE id = ?")
    .get(articleId) as
    | { id: number; link: string; content: string | null; summary: string | null }
    | undefined;
  if (!article) {
    return {
      article_id: articleId,
      status: "failed",
      html: null,
      headings: [],
      reading_minutes: null,
      source: null,
      extracted_at: null,
    };
  }

  let best: Attempt | null = null;

  // 1. The original page. Always tried first, and usually the end of it.
  const page = await fetchPageHtml(article.link, 10_000, PAGE_BYTES);
  if (page) {
    const clean = parseArticle(page.html, page.url);
    if (clean) best = { clean, source: "direct" };

    // 2. The same page, read as data. A publisher that renders the article in
    // the browser leaves a DOM parser with the standfirst and the furniture,
    // and the article itself sitting in a JSON blob two tags away. Always
    // tried, even when the DOM parse looked complete — it costs no request,
    // and "looked complete" is exactly the trap here: WIRED's reviews come out
    // of the DOM as a plausible 1 856 characters and out of the state as
    // 16 787.
    const embedded = parseEmbedded(page.html, page.url);
    if (embedded) {
      // A structured body is the site's own render, and it is preferred on
      // near-equal length rather than made to clear the usual 1.15x bar:
      // Readability is guessing at which parts of the markup were the article,
      // and on WIRED's product guides its guess opens with "Aug 19, 2026
      // 7:31 AM" and the headline.
      //
      // A flattened one — schema.org's plain-text articleBody — has to earn it
      // the normal way. The Verge ships both a real DOM and a flat copy that is
      // 3% longer with a third of the paragraphs, and letting length alone
      // decide handed the reader an article with no pictures in it.
      const enough = embedded.structured
        ? (best?.clean.text.length ?? 0) * 0.8
        : (best?.clean.text.length ?? 0) * BETTER_BY;
      if (embedded.clean.text.length >= enough) {
        best = { clean: embedded.clean, source: "state" };
      }
    }
    if (best && !truncated(best.clean)) return store(articleId, best);
  }

  // 3–5. The page's own full-text renderings, then the two unlock services.
  // Only reached when the direct read failed or came back a teaser, so an
  // ordinary article never pays for them.
  const deadline = Date.now() + CHAIN_BUDGET_MS;
  for (const hop of hops(article.link, page?.html ?? null)) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const fetched = await fetchPageHtml(
      hop.url,
      Math.min(HOP_TIMEOUT_MS, left),
      PAGE_BYTES
    );
    if (!fetched) continue;
    if (!delivered(fetched.url, article.link)) continue;
    const clean = parseArticle(fetched.html, fetched.url);
    if (clean && better(clean, best)) best = { clean, source: hop.source };
    if (best && !truncated(best.clean)) break;
  }

  // Last: what the feed itself published. Plain text, capped at 6 000
  // characters by ingest (CONTENT_MAX_LENGTH in rss.ts) and sometimes only the
  // summary — a poor article, and an honest one. It competes with the hops
  // rather than waiting for all of them to fail, because a page that renders
  // its body in JavaScript hands the parser eighty characters, and eighty
  // characters lose to the feed's six thousand.
  const excerpt = article.content?.trim() || article.summary?.trim() || "";
  if (excerpt.length > 0) {
    const clean = fromFeedExcerpt(excerpt);
    if (clean.text.length > 0 && better(clean, best)) {
      best = { clean, source: "feed" };
    }
  }

  return best && best.clean.text.length >= MIN_USEFUL
    ? store(articleId, best)
    : storeFailure(articleId);
}

// An unlock service that can't reach the article still answers 200 — Marreta
// redirects to /?message=NOT_FOUND — and Readability will cheerfully return
// that home page as a 348-character "article". A hop only counts if the target
// is still in the URL we ended up at. Compared by host and path, because the
// archive normalises trailing slashes.
function delivered(finalUrl: string, link: string): boolean {
  try {
    const target = new URL(link);
    if (!finalUrl.includes(target.hostname)) return false;
    const path = target.pathname.replace(/\/+$/, "");
    return path === "" || finalUrl.includes(path);
  } catch {
    return false;
  }
}

// Did the page hand us the article, or the first paragraph and a sales pitch?
function truncated(clean: Sanitised): boolean {
  if (clean.text.length < ENOUGH) return true;
  const lower = clean.text.toLowerCase();
  return PAYWALL_MARKERS.some((marker) => lower.includes(marker));
}

// The stored excerpt has had its markup stripped by ingest, so rebuild
// paragraphs from its blank lines rather than rendering one 6 000-character
// block.
function fromFeedExcerpt(content: string): Sanitised {
  const paragraphs = content
    .split(/\n{2,}|(?<=[.!?…])\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const html = (paragraphs.length > 0 ? paragraphs : [content.trim()])
    .map((part) => `<p>${escapeHtml(part)}</p>`)
    .join("");
  return sanitizeArticleHtml(html, "about:blank");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function better(candidate: Sanitised, current: Attempt | null): boolean {
  if (!current) return true;
  return candidate.text.length > current.clean.text.length * BETTER_BY;
}

function store(articleId: number, attempt: Attempt): ArticleContentDto {
  const { clean, source } = attempt;
  const minutes = readingMinutes(clean.text);
  const headings = JSON.stringify(clean.headings);
  getDb()
    .prepare(
      `INSERT INTO article_content
         (article_id, html, text, headings, reading_minutes, status, source, attempts, extracted_at)
       VALUES (?, ?, ?, ?, ?, 'ok', ?, 0, datetime('now'))
       ON CONFLICT(article_id) DO UPDATE SET
         html = excluded.html, text = excluded.text, headings = excluded.headings,
         reading_minutes = excluded.reading_minutes, status = 'ok',
         source = excluded.source, attempts = 0, extracted_at = datetime('now')`
    )
    .run(articleId, clean.html, clean.text, headings, minutes, source);
  console.log(
    `[extract] article ${articleId} via ${source} — ${clean.text.length} chars, ${minutes} min`
  );
  return {
    article_id: articleId,
    status: "ok",
    html: clean.html,
    headings: clean.headings,
    reading_minutes: minutes,
    source,
    extracted_at: new Date().toISOString(),
  };
}

function storeFailure(articleId: number): ArticleContentDto {
  getDb()
    .prepare(
      `INSERT INTO article_content
         (article_id, html, text, headings, reading_minutes, status, source, attempts, extracted_at)
       VALUES (?, NULL, NULL, NULL, NULL, 'failed', NULL, 1, datetime('now'))
       ON CONFLICT(article_id) DO UPDATE SET
         status = 'failed', attempts = article_content.attempts + 1,
         extracted_at = datetime('now')`
    )
    .run(articleId);
  console.log(`[extract] article ${articleId} — every hop failed`);
  return {
    article_id: articleId,
    status: "failed",
    html: null,
    headings: [],
    reading_minutes: null,
    source: null,
    extracted_at: new Date().toISOString(),
  };
}

// The Read later trigger: saving an article is a promise to read it later, so
// the text should be waiting. Fire-and-forget — nothing waits on this.
export function extractForLink(link: string): void {
  const article = getDb()
    .prepare("SELECT id FROM articles WHERE link = ? ORDER BY id LIMIT 1")
    .get(link) as { id: number } | undefined;
  if (!article) return;
  void extractArticle(article.id).catch(() => {});
}
