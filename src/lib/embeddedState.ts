// Articles that are in the page but not in the DOM.
//
// A growing number of publishers ship a shell of markup and the article itself
// as JSON for the client to render. WIRED is the case that prompted this: its
// pages carry 25 paragraphs of furniture and a 520 KB
// `window.__PRELOADED_STATE__`, and a DOM parser comes away with the standfirst.
//
// This is not a bypass of anything: it is the document the publisher served,
// read in the form they served it in.
//
// The body arrives as JsonML — `["p", {props}, "text", ["a", {href}, "label"]]`
// — which is a real tree with real paragraph boundaries, so it is rendered as
// one rather than sniffed for prose. An earlier version that scored strings by
// length produced text starting mid-sentence and paragraphs containing
// affiliate URLs, because in this shape the opening of a paragraph is a short
// run and a link's href is just another string.

// Every place a body has been found to hide.
const STATE_KEYS = [
  "__PRELOADED_STATE__",
  "__NEXT_DATA__",
  "__NUXT__",
  "__APOLLO_STATE__",
  "__INITIAL_STATE__",
];

// Containers whose contents are the article.
const BODY_KEY = /^(body|articleBody|bodyHtml|content|blocks|bodyBlocks)$/i;

// …and the keys that hold prose which is emphatically not the article. Without
// this a New Yorker podcast page offers 10 481 characters of contributor
// biographies, which is the longest prose in its state.
const NOT_BODY =
  /contributor|author|byline|related|recirc|newsletter|promo|disclaimer|advert|footer|nav|subscribe|consent|translation|seo|social|comment|config/i;

// Below this a "body" is a summary, a caption or a stray label.
const MIN_BODY_CHARS = 600;

export interface EmbeddedBody {
  html: string;
  // Where in the state it was found, for the log line.
  path: string;
}

// ------------------------------------------------------------ JSON blobs

// Pull every JSON blob a page embeds: <script type="application/(ld+)json">
// and `window.X = {...}` assignments.
function candidateBlobs(html: string): string[] {
  const blobs: string[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    blobs.push(match[1]);
  }
  for (const key of STATE_KEYS) {
    let from = 0;
    for (;;) {
      const at = html.indexOf(key, from);
      if (at < 0) break;
      from = at + key.length;
      const blob = balancedJson(html, from);
      if (blob) blobs.push(blob);
    }
  }
  return blobs;
}

// From the first `{` or `[` after the key, take exactly as far as the matching
// bracket. Reading to the next `</script>` instead swallows the rest of the
// file when one tag holds two assignments, and stops early when the JSON itself
// contains that string.
function balancedJson(html: string, from: number): string | null {
  const offset = html.slice(from, from + 400).search(/[[{]/);
  if (offset < 0) return null;
  const begin = from + offset;
  const open = html[begin];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = begin; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return html.slice(begin, i + 1);
    }
  }
  return null;
}

// ------------------------------------------------------------------ JsonML

type Props = Record<string, unknown>;

// `["tag", props?, ...children]`. The tag is always the first element and
// always a string; a plain object in second place is the props.
function asElement(node: unknown): { tag: string; props: Props; children: unknown[] } | null {
  if (!Array.isArray(node) || typeof node[0] !== "string") return null;
  const second = node[1];
  const hasProps =
    second !== null &&
    typeof second === "object" &&
    !Array.isArray(second);
  return {
    tag: node[0].toLowerCase(),
    props: hasProps ? (second as Props) : {},
    children: node.slice(hasProps ? 2 : 1),
  };
}

// Tags worth keeping, mapped to what the reader's stylesheet knows about.
// Everything else is descended into rather than emitted, so a wrapper loses
// itself and keeps its contents.
const BLOCK = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "figure", "figcaption", "hr",
]);
const INLINE = new Set(["em", "i", "strong", "b", "code", "sup", "sub", "br"]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Some non-HTML tags carry a picture in their props — WIRED's `inline-embed`
// is how photographs appear inside the body. Take the widest source it offers.
function embeddedImage(props: Props): string | null {
  const image = (props.props as Props | undefined)?.image ?? props.image;
  if (!image || typeof image !== "object") return null;
  const sources = (image as Props).sources;
  if (!sources || typeof sources !== "object") return null;
  let widest: { url: string; width: number } | null = null;
  for (const value of Object.values(sources as Props)) {
    if (!value || typeof value !== "object") continue;
    const url = (value as Props).url;
    const width = Number((value as Props).width ?? 0);
    if (typeof url === "string" && (!widest || width > widest.width)) {
      widest = { url, width };
    }
  }
  if (!widest) return null;
  const alt = String((image as Props).altText ?? "");
  const caption = String(
    (props.props as Props | undefined)?.dangerousCaption ?? props.dangerousCaption ?? ""
  ).replace(/<[^>]*>/g, "").trim();
  const figure = `<img src="${escapeHtml(widest.url)}" alt="${escapeHtml(alt)}">`;
  return caption
    ? `<figure>${figure}<figcaption>${escapeHtml(caption)}</figcaption></figure>`
    : figure;
}

function render(node: unknown, depth = 0): string {
  if (depth > 24 || node == null) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return String(node);

  const element = asElement(node);
  if (!element) {
    // A bare array of children, or an object holding some — descend.
    if (Array.isArray(node)) return node.map((child) => render(child, depth + 1)).join("");
    return "";
  }

  const { tag, props, children } = element;
  const inner = children.map((child) => render(child, depth + 1)).join("");

  if (BLOCK.has(tag) || INLINE.has(tag)) return `<${tag}>${inner}</${tag}>`;
  if (tag === "a") {
    const href = typeof props.href === "string" ? props.href : "";
    // Affiliate redirectors are not links a reader wants to follow, and the
    // sanitiser would keep them.
    const usable = /^https?:\/\//.test(href) && !href.includes("/affiliate-link/");
    return usable ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
  }
  if (tag === "img") {
    const src = typeof props.src === "string" ? props.src : "";
    return src ? `<img src="${escapeHtml(src)}" alt="">` : "";
  }
  const picture = embeddedImage(props);
  if (picture) return picture;

  // Unknown tag: keep what is inside it. `div`, `section`, `span` and the
  // publisher's own component names all land here.
  return inner;
}

function textLength(html: string): number {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

// ------------------------------------------------------------------ search

function renderContainer(value: unknown): string {
  if (typeof value === "string") {
    // schema.org articleBody: plain text with blank lines between paragraphs.
    if (/<[a-z][\s\S]*>/i.test(value)) return value;
    return value
      .split(/\n{2,}|\r\n\r\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `<p>${escapeHtml(part)}</p>`)
      .join("");
  }
  return render(value);
}

// Find the container that holds the article, preferring one the page itself
// named `body` over merely the longest — see NOT_BODY for why longest is wrong.
function bestContainer(root: unknown): (EmbeddedBody & { chars: number }) | null {
  let best: (EmbeddedBody & { chars: number }) | null = null;

  function walk(node: unknown, path: string, depth: number) {
    if (depth > 10 || node == null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Props)) {
      if (NOT_BODY.test(key)) continue;
      const here = path ? `${path}.${key}` : key;
      if (BODY_KEY.test(key)) {
        const html = renderContainer(value);
        const chars = textLength(html);
        if (chars >= MIN_BODY_CHARS && (!best || chars > best.chars)) {
          best = { html, path: here, chars };
        }
      }
      walk(value, here, depth + 1);
    }
  }

  walk(root, "", 0);
  return best;
}

// The article a page shipped as data, or null when it shipped none.
export function bodyFromEmbeddedState(html: string): EmbeddedBody | null {
  let best: (EmbeddedBody & { chars: number }) | null = null;
  for (const blob of candidateBlobs(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blob.trim().replace(/;\s*$/, ""));
    } catch {
      continue;
    }
    const found = bestContainer(parsed);
    if (found && (!best || found.chars > best.chars)) best = found;
  }
  return best ? { html: best.html, path: best.path } : null;
}
