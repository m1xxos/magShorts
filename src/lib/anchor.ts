// Finding the same passage again, in an article that will not hold still.
//
// A highlight has to survive three kinds of drift. The body is re-extracted
// whenever a `partial` article is opened and whenever Retry is pressed, so its
// HTML changes under us. Migrations rewrite the stored HTML in place. And the
// reader never renders the stored HTML as-is: splitBody() cuts galleries out
// into React components and wraps runs of prose in separate divs, so the DOM is
// not a serialisation of what the database holds.
//
// So the durable part of an anchor is the text itself — the quote, plus enough
// of what surrounds it to tell two identical sentences apart. Offsets are kept
// too, but only as a cache: they make the common case one comparison instead of
// a search, and they break the tie when a quote occurs twice.

// How much context to keep either side. Long enough that a repeated sentence
// in a listicle is still distinguishable, short enough that an edit to the
// neighbouring paragraph doesn't invalidate the anchor by itself.
const CONTEXT = 64;

export interface Anchor {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface Frame {
  // The whole readable body, normalised: one space between everything.
  text: string;
  nodes: Text[];
  // Per emitted character: which text node it came from, and where in that
  // node's raw data it sits. This is what turns an offset back into a Range.
  nodeIndex: Int32Array;
  charIndex: Int32Array;
}

// Characters that mean "space" but are not one, and characters that mean
// nothing at all. Bodies are full of &#160; — every publisher uses them for
// their own reasons — and a quote captured with one in it must still match a
// re-extraction that used a plain space.
const SPACES = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad]/;

export function normalizeText(value: string): string {
  let out = "";
  let lastWasSpace = false;
  for (const char of value.normalize("NFC")) {
    if (INVISIBLE.test(char)) continue;
    if (SPACES.test(char)) {
      if (!lastWasSpace) out += " ";
      lastWasSpace = true;
      continue;
    }
    out += char;
    lastWasSpace = false;
  }
  return out.trim();
}

// Walk the rendered body and build the frame.
//
// Galleries are skipped: they are React components with their own carousel
// state, their text is a caption rather than the article, and their DOM is
// rebuilt on interaction. Skipping them consistently on both capture and
// resolve means a selection that spans one simply elides it, on both sides.
//
// Whitespace collapses *across* node boundaries, carried by one flag through
// the whole walk. That is what makes the frame identical whether or not
// highlights are currently applied: wrapping text in a <mark> splits Text
// nodes, but a split contributes no characters of its own.
export function buildFrame(root: HTMLElement): Frame {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-gallery], [data-no-anchor]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  const nodeAt: number[] = [];
  const charAt: number[] = [];
  let text = "";
  let lastWasSpace = true; // leading whitespace is dropped, as trim() would

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    const index = nodes.length;
    nodes.push(node as Text);
    for (let at = 0; at < value.length; at++) {
      const char = value[at].normalize("NFC");
      if (INVISIBLE.test(char)) continue;
      if (SPACES.test(char)) {
        if (lastWasSpace) continue;
        text += " ";
        nodeAt.push(index);
        charAt.push(at);
        lastWasSpace = true;
        continue;
      }
      text += char;
      nodeAt.push(index);
      charAt.push(at);
      lastWasSpace = false;
    }
  }

  // A trailing space would be trimmed off `text` by the reader's own
  // normaliser, so drop it here to keep text and the index arrays the same
  // length.
  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    nodeAt.pop();
    charAt.pop();
  }

  return {
    text,
    nodes,
    nodeIndex: Int32Array.from(nodeAt),
    charIndex: Int32Array.from(charAt),
  };
}

// Where in the frame does a DOM position fall?
//
// Both kinds of boundary have to work. A drag inside a paragraph gives a text
// node and an offset into it; a triple-click gives the paragraph element and a
// child index; and an upward drag routinely ends at offset 0 of a node, which
// means "just before this node" and has no character of its own to point at.
function boundaryOffset(
  frame: Frame,
  container: Node,
  offset: number,
  isEnd: boolean
): number | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const index = frame.nodes.indexOf(container as Text);
    if (index < 0) return firstEmittedFrom(frame, container);
    for (let at = 0; at < frame.nodeIndex.length; at++) {
      if (frame.nodeIndex[at] !== index) continue;
      // The first emitted character at or after the offset. For an end
      // boundary that character is excluded, which is exactly right: a
      // boundary at offset 0 — where an upward drag routinely lands — ends
      // before the node rather than inside it.
      if (frame.charIndex[at] >= offset) return at;
    }
    const last = lastIndexOf(frame, index);
    if (last >= 0) return last + 1;
    return isEnd ? lastEmittedBefore(frame, container) : firstEmittedFrom(frame, container);
  }

  // An element boundary: childNodes[offset] is the node it sits before, and
  // undefined means the end of the element's own content.
  const child = container.childNodes[offset];
  if (isEnd) {
    return child
      ? lastEmittedBefore(frame, child)
      : lastEmittedInside(frame, container);
  }
  return child
    ? firstEmittedFrom(frame, child)
    : lastEmittedInside(frame, container);
}

// Document-order helpers over the frame. The frame's nodes are in document
// order, so these are scans, not tree walks.
function firstIndexOf(frame: Frame, node: number): number {
  for (let at = 0; at < frame.nodeIndex.length; at++) {
    if (frame.nodeIndex[at] === node) return at;
  }
  return -1;
}

function lastIndexOf(frame: Frame, node: number): number {
  for (let at = frame.nodeIndex.length - 1; at >= 0; at--) {
    if (frame.nodeIndex[at] === node) return at;
  }
  return -1;
}

// The first character at or after this node — the start of a boundary that
// sits before it.
function firstEmittedFrom(frame: Frame, node: Node): number | null {
  for (let index = 0; index < frame.nodes.length; index++) {
    const candidate = frame.nodes[index];
    const isAtOrAfter =
      candidate === node ||
      node.contains(candidate) ||
      (node.compareDocumentPosition(candidate) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0;
    if (!isAtOrAfter) continue;
    const at = firstIndexOf(frame, index);
    if (at >= 0) return at;
  }
  return null;
}

// The end of the last character before this node — the end of a boundary that
// sits before it.
function lastEmittedBefore(frame: Frame, node: Node): number | null {
  let best: number | null = null;
  for (let index = 0; index < frame.nodes.length; index++) {
    const candidate = frame.nodes[index];
    const isBefore =
      candidate !== node &&
      !node.contains(candidate) &&
      (node.compareDocumentPosition(candidate) &
        Node.DOCUMENT_POSITION_PRECEDING) !==
        0;
    if (!isBefore) continue;
    const at = lastIndexOf(frame, index);
    if (at >= 0) best = at + 1;
  }
  return best;
}

// The end of the last character inside this element — where "select the whole
// paragraph" ends, which is what a triple-click produces.
function lastEmittedInside(frame: Frame, element: Node): number | null {
  let best: number | null = null;
  for (let index = 0; index < frame.nodes.length; index++) {
    if (!element.contains(frame.nodes[index])) continue;
    const at = lastIndexOf(frame, index);
    if (at >= 0) best = at + 1;
  }
  return best;
}

// A selection, described so it can be found again.
export function describeRange(frame: Frame, range: Range): Anchor | null {
  const start = boundaryOffset(frame, range.startContainer, range.startOffset, false);
  const end = boundaryOffset(frame, range.endContainer, range.endOffset, true);
  if (start === null || end === null || end <= start) return null;
  const quote = frame.text.slice(start, end).trim();
  if (!quote) return null;
  // Re-derive the bounds from the trimmed quote so a selection that swept up a
  // leading space anchors on the words, not on the whitespace.
  const from = frame.text.indexOf(quote, Math.max(0, start - 2));
  const at = from < 0 ? start : from;
  return {
    quote,
    prefix: frame.text.slice(Math.max(0, at - CONTEXT), at),
    suffix: frame.text.slice(at + quote.length, at + quote.length + CONTEXT),
    start: at,
    end: at + quote.length,
  };
}

function allIndexes(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

function nearest(candidates: number[], to: number): number {
  return candidates.reduce((best, at) =>
    Math.abs(at - to) < Math.abs(best - to) ? at : best
  );
}

// Publishers change their typography between renderings more often than they
// change their words: the AMP copy uses straight quotes where the article page
// uses curly ones, an em dash becomes a hyphen. Folding both sides costs one
// extra pass and is only paid when the strict search has already failed.
//
// Every rule here must preserve length, because an index found in the folded
// string is used directly as an index into the strict one. That rules out the
// obvious … → "..." — one character for three would slide every match after
// it two places left, and the mark would land on the wrong words — and it is
// why toLowerCase is applied per character and refused when it changes length
// (İ lowercases to two code units).
const SINGLE_QUOTES = /[‘’‚‛']/;
const DOUBLE_QUOTES = /[“”„‟"]/;
const DASHES = /[–—−]/;

function fold(value: string): string {
  let out = "";
  for (const char of value) {
    const mapped = SINGLE_QUOTES.test(char)
      ? "'"
      : DOUBLE_QUOTES.test(char)
        ? '"'
        : DASHES.test(char)
          ? "-"
          : char;
    const lower = mapped.toLowerCase();
    out += lower.length === mapped.length ? lower : mapped;
  }
  return out;
}

export interface Resolved {
  start: number;
  end: number;
}

// Find the anchor in this frame, or admit that it is not there.
//
// The order matters: the cheap certain answer first, then progressively weaker
// evidence. `sameBody` says whether the offsets were recorded against this
// exact body — when they were, and the text still reads the same, there is
// nothing to search for.
export function resolveAnchor(
  frame: Frame,
  anchor: Anchor,
  sameBody: boolean
): Resolved | null {
  const quote = normalizeText(anchor.quote);
  if (!quote) return null;

  if (
    sameBody &&
    anchor.start >= 0 &&
    frame.text.slice(anchor.start, anchor.end) === quote
  ) {
    return { start: anchor.start, end: anchor.end };
  }

  const prefix = normalizeText(anchor.prefix ?? "");
  const suffix = normalizeText(anchor.suffix ?? "");

  for (const [before, after] of [
    [prefix, suffix],
    [prefix, ""],
    ["", suffix],
  ] as const) {
    if (!before && !after) continue;
    const hits = allIndexes(frame.text, before + quote + after);
    if (hits.length === 1) {
      const start = hits[0] + before.length;
      return { start, end: start + quote.length };
    }
  }

  const bare = allIndexes(frame.text, quote);
  if (bare.length === 1) return { start: bare[0], end: bare[0] + quote.length };
  if (bare.length > 1) {
    // Several identical passages. The one nearest to where it used to be is a
    // far better guess than the first: a re-extraction moves text by hundreds
    // of characters, not thousands.
    const start = nearest(bare, anchor.start);
    return { start, end: start + quote.length };
  }

  const folded = fold(frame.text);
  const foldedHits = allIndexes(folded, fold(quote));
  if (foldedHits.length > 0) {
    // The fold is character-for-character — only case and punctuation shape
    // change — so an index in the folded string is an index in the strict one.
    const start = foldedHits.length === 1 ? foldedHits[0] : nearest(foldedHits, anchor.start);
    return { start, end: start + quote.length };
  }

  return null;
}

// Turn a resolved span back into a live Range.
export function rangeOf(frame: Frame, span: Resolved): Range | null {
  if (span.start < 0 || span.end > frame.nodeIndex.length || span.end <= span.start) {
    return null;
  }
  const range = document.createRange();
  const startNode = frame.nodes[frame.nodeIndex[span.start]];
  const endNode = frame.nodes[frame.nodeIndex[span.end - 1]];
  if (!startNode || !endNode) return null;
  range.setStart(startNode, frame.charIndex[span.start]);
  range.setEnd(endNode, frame.charIndex[span.end - 1] + 1);
  return range;
}

// Wrap a resolved span in <mark> elements.
//
// One mark per text node rather than one per highlight, because a range that
// crosses a paragraph cannot be wrapped in a single element without producing
// markup that is not valid and does not lay out. The pieces share a data-hl,
// and the outer two are tagged so CSS can round only the real end caps.
//
// Callers must apply spans back-to-front: splitting a text node invalidates
// every index after the split, and going backwards means each application only
// disturbs ground already covered.
export function applySpan(
  frame: Frame,
  span: Resolved,
  id: number,
  hasNote: boolean
): boolean {
  const runs: Array<{ node: Text; from: number; to: number }> = [];
  for (let at = span.start; at < span.end; at++) {
    const nodeAt = frame.nodeIndex[at];
    const charAt = frame.charIndex[at];
    const last = runs[runs.length - 1];
    if (last && frame.nodes[nodeAt] === last.node) last.to = charAt + 1;
    else runs.push({ node: frame.nodes[nodeAt], from: charAt, to: charAt + 1 });
  }
  if (runs.length === 0) return false;

  runs.forEach((run, index) => {
    const node = run.node;
    if (run.to < node.data.length) node.splitText(run.to);
    const middle = run.from > 0 ? node.splitText(run.from) : node;
    const mark = document.createElement("mark");
    mark.dataset.hl = String(id);
    if (index === 0) mark.dataset.hlStart = "";
    if (index === runs.length - 1) mark.dataset.hlEnd = "";
    if (hasNote) mark.dataset.note = "";
    middle.replaceWith(mark);
    mark.appendChild(middle);
  });
  return true;
}

// Take the marks back out, and re-join the text they split.
export function unwrapHighlight(root: HTMLElement, id: number): void {
  for (const mark of [...root.querySelectorAll(`mark[data-hl="${id}"]`)]) {
    const parent = mark.parentElement;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize();
  }
}

// A cheap fingerprint of the stored body, so the reader can tell whether the
// offsets it recorded were taken against the article it is looking at now.
// FNV-1a: not a security property, just a fast 32-bit "same or not".
export function bodyFingerprint(html: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < html.length; at++) {
    hash ^= html.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
