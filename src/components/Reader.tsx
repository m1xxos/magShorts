"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ArticleContentDto,
  type HighlightDto,
  type ArticleDto,
  feedTone,
  timeAgo,
} from "@/lib/types";
import { cachedImageUrl, recordEvent, unlockUrl } from "@/lib/actions";
import { readProgress, writeProgress } from "@/lib/readProgress";
import { BookmarkIcon, ExternalIcon } from "./SwipeableCard";
import { ReaderGallery, type Slide } from "./ReaderGallery";
import { ReaderOutline } from "./ReaderOutline";
import { ReaderUpNext } from "./ReaderUpNext";
import { Sheet } from "./ui/Sheet";
import { Segmented } from "./ui/Segmented";
import { Menu, separator } from "./ui/Menu";
import {
  ReaderHighlightPopover,
  type PopoverAt,
} from "./ReaderHighlightPopover";
import { ReaderNoteEditor } from "./ReaderNoteEditor";
import {
  applySpan,
  buildFrame,
  describeRange,
  resolveAnchor,
  unwrapHighlight,
  type Anchor,
  type Frame,
} from "@/lib/anchor";
import {
  createHighlight,
  deleteHighlight,
  highlightsAsText,
  listHighlights,
  reanchor,
  updateHighlight,
  type Reanchored,
} from "@/lib/highlights";
import { useMediaQuery } from "@/lib/useMediaQuery";

// The in-app reader: an article opened over the grid instead of in a new tab.
//
// It is an overlay rather than a route on purpose. The grid is a client
// component holding its articles, its pagination and its scroll position in
// React state; routing to /read/:id would unmount all of it and the reader
// would have nothing to go back to. The URL still changes — Next supports
// window.history.pushState directly — so the view is linkable and the browser
// Back button closes it, but the list underneath is never torn down.

const TYPE_STEPS = [16, 18, 20.5];
// The handoff's 720px puts about 70 characters on a line at 18px, which is the
// measure the design is built around — so it stays the middle setting rather
// than becoming one option among three.
const WIDTH_STEPS = [
  { px: 620, label: "Narrow" },
  { px: 720, label: "Normal" },
  { px: 880, label: "Wide" },
];
// The items following `index` in a list, for the reader's list-order fallback.
// The guard is the point: findIndex returns -1 when the reader was opened from
// a link rather than from the list — a pasted ?article=, or a Read later row
// the reader just un-saved out of the list — and `slice(-1 + 1)` is `slice(0)`,
// which hands back the whole list and offers the first articles as if they
// came after the one being read.
export function after<T>(list: T[], index: number): T[] {
  return index < 0 ? [] : list.slice(index + 1, index + 1 + UP_NEXT);
}

// How many cards the right rail holds. Exported because each page builds
// its own list-order fallback and both have to agree on the length.
export const UP_NEXT = 4;
// Under five seconds nobody read anything — the same "a tap that bounced"
// line readProgress.ts already draws. The hour is the other end: an article
// left open on a second monitor is not an hour of reading.
const MIN_READ_SECONDS = 5;
const MAX_READ_SECONDS = 3600;
const TYPE_KEY = "ms_reader_type";
// Clears the sticky top bar (64px) and the progress rule (3px), plus a little
// air. Used by both rails and by the outline's own scroll box.
const RAIL_TOP = 83;

// The id the not-yet-saved passage wears while the bar is open. Negative, so it
// can never collide with a row id.
const PENDING = -1;

// The article body, cut into the runs of ordinary HTML and the galleries
// between them. Galleries become a real component; everything else stays a
// string, because an article is markup and React has no business rebuilding
// paragraph by paragraph.
type Segment =
  | { kind: "html"; html: string }
  | { kind: "gallery"; slides: Slide[] };

function splitBody(html: string): Segment[] {
  if (!html) return [];
  // DOMParser rather than a regex: the block is nested, and a regex that can
  // find the right closing tag is a regex that will one day find the wrong one.
  if (typeof DOMParser === "undefined") return [{ kind: "html", html }];
  const parsed = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html"
  );
  const segments: Segment[] = [];
  let buffer = "";
  function flush() {
    if (buffer) segments.push({ kind: "html", html: buffer });
    buffer = "";
  }
  for (const node of [...parsed.body.childNodes]) {
    const element = node instanceof Element ? node : null;
    if (element?.classList.contains("reader-gallery")) {
      flush();
      const slides = [...element.querySelectorAll("figure")].map((figure) => {
        const image = figure.querySelector("img");
        return {
          src: image?.getAttribute("src") ?? "",
          full: image?.getAttribute("data-full") ?? "",
          caption: figure.querySelector("figcaption")?.textContent?.trim() ?? "",
          width: Number(image?.getAttribute("width") ?? 0),
          height: Number(image?.getAttribute("height") ?? 0),
        };
      });
      if (slides.length > 1) segments.push({ kind: "gallery", slides });
      continue;
    }
    buffer += element ? element.outerHTML : (node.textContent ?? "");
  }
  flush();
  return segments;
}

// A picture opened over the article. Galleries hand over the whole set, so
// the arrows keep working once it is open.
interface Lightbox {
  items: Array<{ src: string; caption: string }>;
  index: number;
}

// A link around an image is usually the full-size file; sometimes it is a
// genuine link to somewhere else, and clicking that should still go there.
const IMAGE_HREF = /\.(jpe?g|png|gif|webp|avif)($|\?)/i;

function fullSize(image: HTMLImageElement): string {
  const stated = image.getAttribute("data-full");
  const href = stated ?? image.closest("a")?.getAttribute("href") ?? "";
  // Through the cache, like every other image here: opening a picture full
  // size should not be the one thing that calls the publisher directly.
  return IMAGE_HREF.test(href) ? cachedImageUrl(href) : image.src;
}

function captionOf(image: HTMLImageElement): string {
  const figure = image.closest("figure");
  const caption =
    figure?.querySelector("figcaption")?.textContent ??
    image.getAttribute("alt") ??
    "";
  return caption.trim();
}

interface TypeSetting {
  step: number;
  width: number;
  serif: boolean;
}

// Is this summary just the top of the article again? Compared on the first
// words with the markup and punctuation stripped, because the feed's copy and
// the page's differ in quotes, dashes and ellipses.
function repeatsBody(summary: string, bodyHtml: string): boolean {
  const shape = (text: string) =>
    text
      .replace(/<[^>]*>/g, " ")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const opening = shape(summary).split(" ").slice(0, 12).join(" ");
  if (opening.length < 30) return false;
  return shape(bodyHtml).startsWith(opening);
}

function clampStep(
  value: number | undefined,
  count: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(count - 1, Math.max(0, Math.round(value)));
}

// Where the text came from, said plainly. A reader should never have to guess
// whether it is looking at the article or at what the feed happened to ship.
const SOURCE_LABEL: Record<string, string> = {
  direct: "",
  state: "rebuilt from the page’s own data",
  amp: "from the publisher’s print edition",
  marreta: "unlocked via Marreta",
  archive: "from the Internet Archive",
  feed: "only the feed’s excerpt — the full text could not be fetched",
};

export function Reader({
  article,
  originLabel,
  upNext,
  saved,
  onToggleSave,
  onToast,
  showHighlights = false,
  onOpenArticle,
  onClose,
}: {
  article: ArticleDto;
  // Names where the reader was opened from, for the back link.
  originLabel: string;
  upNext: ArticleDto[];
  saved: boolean;
  // Saves, or un-saves when it is already saved — a filled bookmark you can't
  // click off is a state, not a control.
  onToggleSave: () => void;
  // The host page owns the Toast; the reader borrows it to say what it did.
  onToast?: (message: string, error?: boolean) => void;
  // Opened from something that points at the highlights — the chip in Read
  // later — so the list is what you land on.
  showHighlights?: boolean;
  onOpenArticle: (article: ArticleDto) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState<ArticleContentDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [type, setType] = useState<TypeSetting>({
    step: 1,
    width: 1,
    serif: true,
  });
  const [typeOpen, setTypeOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // A popover on a mouse, a sheet on a finger: in a 176px panel each of the
  // five text sizes gets about 30px of tap area.
  const touch = useMediaQuery("(pointer: coarse)");
  const portrait = useMediaQuery("(orientation: portrait)");
  // The width at which the rail appears. Below it the highlights live in a
  // sheet; above it they live in the rail, and the sheet must not exist at all
  // or arriving from Read later would cover the article with it.
  const wide = useMediaQuery("(min-width: 1180px)");
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  const [highlights, setHighlights] = useState<HighlightDto[]>([]);
  // What the selection bar is pointing at: a fresh selection, or a highlight
  // that was clicked.
  const [pending_, setPending] = useState<{
    at: PopoverAt;
    anchor: Anchor | null;
    highlight: HighlightDto | null;
  } | null>(null);
  const [highlightsOpen, setHighlightsOpen] = useState(showHighlights);
  // The note being written, held here rather than inside the editor: on touch
  // the editor is a Sheet, Sheet unmounts its children when it closes, and it
  // closes on a downward drag — a draft kept inside would die to a gesture.
  const [draft, setDraft] = useState<string | null>(null);
  // Which of the rail's two lists is showing above 1180px. Null until the
  // reader picks one, so keeping a first passage can open the list without
  // ever overriding a choice made afterwards.
  const [railChoice, setRailChoice] = useState<"article" | "highlights" | null>(
    showHighlights ? "highlights" : null
  );
  const [keptThisSession, setKeptThisSession] = useState(false);
  // Where each drawn highlight sits down the body, as a fraction. Feeds the
  // gutter; written by the effect that draws the marks, which is keyed on
  // content and the list, so this cannot make it run again.
  const [ticks, setTicks] = useState<
    Array<{ id: number; top: number; height: number }>
  >([]);
  const frameRef = useRef<Frame | null>(null);
  // The live range, so the bar can follow the selection while the page scrolls.
  const liveRange = useRef<Range | null>(null);
  // Articles about the same thing as this one. Empty is a normal answer.
  const [related, setRelated] = useState<ArticleDto[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Highest fraction reached, not the current one: scrolling back up should
  // not un-read the article.
  const reached = useRef(0);
  // Time on screen. The clock runs only while the tab is visible, which is the
  // difference between "how long you read" and "how long the tab was open".
  const visibleSince = useRef<number | null>(null);
  const secondsRead = useRef(0);
  const ticking = useRef(false);
  const pending = useRef(0);
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(TYPE_KEY);
    if (!saved) {
      // Nothing stored yet: pick the step, once. The default ramp position is
      // tuned for a laptop at 60cm, and a tablet is held further away — but
      // this is a starting point, not an override, so the Aa control keeps
      // working the moment it is touched.
      if (window.matchMedia("(pointer: coarse)").matches) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time media query after hydration
        setType((current) => ({ ...current, step: TYPE_STEPS.length - 1 }));
      }
      return;
    }
    try {
      // Read field by field: settings stored before the width control existed
      // should keep their size and typeface rather than being thrown away.
      const parsed = JSON.parse(saved) as Partial<TypeSetting>;
      setType((current) => ({
        step: clampStep(parsed.step, TYPE_STEPS.length, current.step),
        width: clampStep(parsed.width, WIDTH_STEPS.length, current.width),
        serif: typeof parsed.serif === "boolean" ? parsed.serif : current.serif,
      }));
    } catch {
      // A hand-edited value; the defaults are fine.
    }
  }, []);

  function changeType(next: TypeSetting) {
    setType(next);
    window.localStorage.setItem(TYPE_KEY, JSON.stringify(next));
  }

  const load = useCallback(
    async (retry: boolean) => {
      setLoading(true);
      setContent(null);
      try {
        // POST is cache-first on the server, so a second open costs one
        // indexed read and no request to the publisher. `retry` is the only
        // thing that makes it go back out for an article that already failed.
        const response = await fetch(
          `/api/articles/${article.id}/content${retry ? "?retry=1" : ""}`,
          { method: "POST" }
        );
        setContent(
          response.ok ? ((await response.json()) as ArticleContentDto) : null
        );
      } catch {
        setContent(null);
      } finally {
        setLoading(false);
      }
    },
    [article.id]
  );

  // What to read next, ranked against the article on screen rather than by
  // where it happened to sit in a list. Anything the ranking can't fill — a
  // cold start, an article not embedded yet, a subject nothing else covers —
  // falls back to the list order the reader was opened with.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/articles/${article.id}/related?limit=${UP_NEXT}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((found: ArticleDto[]) => {
        if (!cancelled) setRelated(Array.isArray(found) ? found : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [article.id]);

  useEffect(() => {
    reached.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting per-article view state when the reader swaps articles
    setProgress(0);
    setActiveId(null);
    load(false);
    recordEvent(article.link, "open", article.title);
  }, [load, article.link, article.title]);

  // Whatever the debounce still owes, paid before the reader goes away.
  useEffect(() => {
    const id = article.id;
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
        writeProgress(id, pending.current);
      }
    };
  }, [article.id]);

  // The page underneath must not scroll while the overlay is open, or closing
  // the reader lands the grid somewhere the user never was.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Finishing an article is the strongest signal this app can collect, and it
  // only exists because this view keeps the reader here long enough to see it.
  useEffect(() => {
    const link = article.link;
    return () => {
      if (reached.current >= 0.9) recordEvent(link, "dwell", article.title);
    };
  }, [article.link, article.title]);

  // How long the article was actually read. Nothing else in the app records a
  // duration — "Your reading" would otherwise be estimating every minute it
  // shows from word counts.
  useEffect(() => {
    const link = article.link;
    const title = article.title;
    secondsRead.current = 0;
    visibleSince.current =
      document.visibilityState === "visible" ? Date.now() : null;

    const stop = () => {
      if (visibleSince.current === null) return;
      secondsRead.current += (Date.now() - visibleSince.current) / 1000;
      visibleSince.current = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        visibleSince.current ??= Date.now();
      } else {
        stop();
      }
    };
    // Zeroing the tally is what makes this safe to call twice: a pagehide
    // followed by the unmount sends one event, not two.
    const flush = () => {
      stop();
      const seconds = Math.min(
        Math.round(secondsRead.current),
        MAX_READ_SECONDS
      );
      secondsRead.current = 0;
      if (seconds >= MIN_READ_SECONDS) {
        recordEvent(link, "read", title, seconds);
      }
    };

    // Coming back from the back/forward cache fires pageshow and nothing
    // else, so without this the clock stopped by the preceding pagehide would
    // never start again and the rest of the reading would go unrecorded.
    const onShow = () => {
      if (document.visibilityState === "visible") visibleSince.current ??= Date.now();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("pageshow", onShow);
      flush();
    };
  }, [article.link, article.title]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (lightbox) {
        // The topmost thing closes first, and the arrows belong to it while
        // it is open.
        if (event.key === "Escape") setLightbox(null);
        if (event.key === "ArrowLeft") setLightbox(step(lightbox, -1));
        if (event.key === "ArrowRight") setLightbox(step(lightbox, 1));
        return;
      }
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, lightbox]);

  // Restore where the reader stopped last time, once the body is on screen.
  useEffect(() => {
    if (!content?.html) return;
    const container = scrollRef.current;
    if (!container) return;
    const stored = readProgress()[String(article.id)];
    if (!stored || stored <= 0.02 || stored >= 0.98) return;
    const frame = requestAnimationFrame(() => {
      container.scrollTop =
        stored * (container.scrollHeight - container.clientHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [content, article.id]);

  // Scrolling a long article fires this dozens of times a second, and the
  // first version did a full re-render and a synchronous localStorage
  // read-modify-write on every one of them. Both are gone: the work is
  // coalesced into one animation frame, the state only changes when the
  // rounded percentage does (so React bails out of most renders), and the
  // saved position is written after scrolling stops.
  function onScroll() {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const container = scrollRef.current;
      if (!container) return;
      const span = container.scrollHeight - container.clientHeight;
      const fraction = span > 0 ? Math.min(1, container.scrollTop / span) : 0;
      reached.current = Math.max(reached.current, fraction);
      // The selection bar is positioned in viewport coordinates, so it has to
      // follow its own selection rather than sit still. This rides the frame
      // the scroll handler already coalesces to.
      if (liveRange.current) {
        const box = liveRange.current.getBoundingClientRect();
        setPending((previous) =>
          previous?.anchor
            ? {
                ...previous,
                at: { top: box.top, bottom: box.bottom, left: box.left + box.width / 2 },
              }
            : previous
        );
      }
      setProgress((previous) =>
        Math.round(previous * 100) === Math.round(fraction * 100)
          ? previous
          : fraction
      );
      persist(fraction);
    });
  }

  function persist(fraction: number) {
    pending.current = fraction;
    if (persistTimer.current !== null) return;
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      writeProgress(article.id, pending.current);
    }, 500);
  }

  // The outline entry that matches where the body actually is.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !content?.headings.length) return;
    const nodes = content.headings
      .map((heading) => body.querySelector(`#${CSS.escape(heading.id)}`))
      .filter((node): node is Element => node !== null);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { root: scrollRef.current, rootMargin: "-64px 0px -70% 0px" }
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [content]);

  // Everything kept out of this article, whether or not it can still be found
  // in it.
  useEffect(() => {
    let cancelled = false;
    listHighlights(article.link).then((rows) => {
      if (!cancelled) setHighlights(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [article.link]);

  // Draw them.
  //
  // Keyed on the body and the list, and nothing else. ArticleHtml writes the
  // prose into the DOM itself and React never touches it again, so the state
  // that churns on every scroll frame cannot disturb the marks — only a reload
  // of the article can, and that is exactly when this runs again.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !content?.html) return;

    for (const mark of [...body.querySelectorAll("mark[data-hl]")]) {
      const parent = mark.parentElement;
      mark.replaceWith(...mark.childNodes);
      parent?.normalize();
    }

    const frame = buildFrame(body);
    frameRef.current = frame;
    if (highlights.length === 0) return;

    const moved: Reanchored[] = [];
    const placed: Array<{ id: number; start: number; end: number; note: boolean }> = [];
    for (const highlight of highlights) {
      const span = resolveAnchor(
        frame,
        {
          quote: highlight.quote,
          prefix: highlight.prefix ?? "",
          suffix: highlight.suffix ?? "",
          start: highlight.start_offset ?? -1,
          end: highlight.end_offset ?? -1,
        },
        Boolean(highlight.body_hash) && highlight.body_hash === content.body_hash
      );
      if (!span) {
        if (!highlight.orphaned) moved.push({ id: highlight.id, orphaned: true });
        continue;
      }
      placed.push({ ...span, id: highlight.id, note: Boolean(highlight.note) });
      const drifted =
        span.start !== highlight.start_offset ||
        span.end !== highlight.end_offset ||
        content.body_hash !== highlight.body_hash;
      if (drifted || highlight.orphaned) {
        moved.push({
          id: highlight.id,
          start_offset: span.start,
          end_offset: span.end,
          body_hash: content.body_hash,
        });
      }
    }

    // Back to front: splitting a text node invalidates every offset after the
    // split, so each application must only disturb ground already covered.
    placed.sort((a, b) => b.start - a.start);
    for (const span of placed) {
      applySpan(frame, span, span.id, span.note);
    }
    // The marks split text nodes, so the map has to be rebuilt before anything
    // reads offsets again — the text itself is unchanged, only the nodes are.
    frameRef.current = buildFrame(body);

    // One request, and only when something actually moved.
    reanchor(moved);
    setTicks(measureTicks(body, placed.map((span) => span.id)));
  }, [content, highlights]);

  // The prose reflows for reasons the reader never hears about: a late image
  // resolving its height, the Aa control, an iPad turning over. The ticks are
  // positions in that prose, so they are measured again when it changes shape.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || ticks.length === 0) return;
    const observer = new ResizeObserver(() => {
      setTicks((previous) =>
        measureTicks(
          body,
          previous.map((tick) => tick.id)
        )
      );
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [ticks.length]);

  // Click any picture to see it properly. Delegated from the body, because the
  // article arrives as an HTML string and there is nothing to hang an onClick
  // on. An image wrapped in a link to somewhere that isn't an image file is
  // left alone — that is a real link and it should still go there.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !content?.html) return;

    function onClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;

      // A click that ends a drag is the end of a selection, not a click on
      // whatever happens to be under the cursor.
      if (!window.getSelection()?.isCollapsed) return;

      const mark = target?.closest?.("mark[data-hl]");
      if (mark instanceof HTMLElement) {
        // A highlighted link is still a link.
        if (target?.closest("a[href]")) return;
        const id = Number(mark.dataset.hl);
        const highlight = highlights.find((entry) => entry.id === id);
        if (!highlight) return;
        event.preventDefault();
        const box = mark.getBoundingClientRect();
        setPending({
          at: { top: box.top, bottom: box.bottom, left: box.left + box.width / 2 },
          anchor: null,
          highlight,
        });
        return;
      }

      const image = target?.closest?.("img");
      if (!(image instanceof HTMLImageElement)) return;
      // A gallery is a React component with its own click handling; this
      // listener is only for the loose pictures in the prose.
      if (image.closest("[data-gallery]")) return;
      const href = image.closest("a")?.getAttribute("href");
      if (href && !IMAGE_HREF.test(href) && !image.hasAttribute("data-full")) {
        return;
      }
      event.preventDefault();
      setLightbox({
        items: [{ src: fullSize(image), caption: captionOf(image) }],
        index: 0,
      });
    }

    body.addEventListener("click", onClick);
    return () => body.removeEventListener("click", onClick);
  }, [content, highlights]);

  // A selection inside the article, offered as a highlight.
  //
  // Mouse: the gesture ends on mouseup, or on keyup for a shift-arrow
  // selection. Touch: iOS finishes a long-press selection without any event of
  // ours firing, so selectionchange is the only signal — debounced, because it
  // fires continuously while the handles are being dragged.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !content?.html) return;
    const article_ = body;

    let timer: number | null = null;

    function offer() {
      // A cached frame is only good while its nodes are the ones on screen.
      // Rebuilding when they are not costs one walk and removes a whole class
      // of "the highlight went to the wrong place" bug.
      if (frameRef.current && !frameRef.current.nodes[0]?.isConnected) {
        frameRef.current = buildFrame(article_);
      }
      const frame = frameRef.current;
      const selection = window.getSelection();
      if (!frame || !selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        return;
      }
      const range = selection.getRangeAt(0);
      // Only the article: the headline, the standfirst and the rails are not
      // things you can keep.
      if (!article_.contains(range.commonAncestorContainer)) return;
      const described = describeRange(frame, range);
      if (!described) return;
      const box = range.getBoundingClientRect();
      liveRange.current = range;
      // Draw the passage as a highlight straight away, in the pending shade.
      // The browser drops its own selection the moment focus moves — to the
      // bar, to a tap, to iOS dismissing its callout — and a bar hovering over
      // text that no longer looks selected is a bar about nothing.
      const span = resolveAnchor(frame, described, true);
      if (span) {
        applySpan(frame, span, PENDING, false);
        frameRef.current = buildFrame(article_);
      }
      setPending({
        at: { top: box.top, bottom: box.bottom, left: box.left + box.width / 2 },
        anchor: described,
        highlight: null,
      });
    }

    function onMouseUp() {
      // After the browser has settled the selection, not during it.
      window.setTimeout(offer, 0);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.shiftKey) offer();
    }
    function onSelectionChange() {
      if (!touch) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(offer, 350);
    }
    // A finger lifting off is a far better signal than a timer, and a right
    // click on a selection is a request to do something with it — both of
    // which Omnivore listens for, and both of which this was missing.
    function onTouchEnd() {
      window.setTimeout(offer, 0);
    }

    // On the document, not on the article: dragging upwards, the button comes
    // up wherever the pointer happens to be, which is very often the column's
    // left margin — outside the prose and outside any listener attached to it.
    // The range is checked instead, which is the thing that actually matters.
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("contextmenu", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("contextmenu", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [content, touch]);

  function clearPending() {
    setDraft(null);
    if (bodyRef.current) {
      unwrapHighlight(bodyRef.current, PENDING);
      frameRef.current = buildFrame(bodyRef.current);
    }
    liveRange.current = null;
    setPending(null);
  }

  async function keep(note: string | null) {
    if (!pending_?.anchor) return;
    clearPending();
    // Wrapping a live selection collapses it on WebKit anyway; clearing it
    // deliberately means the same thing happens everywhere.
    window.getSelection()?.removeAllRanges();
    const created = await createHighlight(
      article,
      pending_.anchor,
      content?.body_hash ?? null,
      note
    );
    if (created) {
      // In reading order from the moment it exists: the rail's list is headed
      // "In reading order", and appending would make that heading a lie until
      // the next time the article is opened.
      setHighlights((previous) =>
        [...previous, created].sort(
          (a, b) => (a.start_offset ?? 0) - (b.start_offset ?? 0) || a.id - b.id
        )
      );
      setKeptThisSession(true);
    }
  }

  async function annotate(highlight: HighlightDto, note: string) {
    clearPending();
    setHighlights((previous) =>
      previous.map((entry) => (entry.id === highlight.id ? { ...entry, note } : entry))
    );
    await updateHighlight(highlight.id, note);
  }

  async function forget(highlight: HighlightDto) {
    clearPending();
    if (bodyRef.current) unwrapHighlight(bodyRef.current, highlight.id);
    setHighlights((previous) => previous.filter((entry) => entry.id !== highlight.id));
    await deleteHighlight(highlight.id);
  }

  // Animated rather than scrollIntoView: the overlay is the scroll container,
  // and scrollIntoView also scrolls whatever ancestor it feels like.
  function jump(id: string) {
    const target = bodyRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (target) jumpTo(target);
    setActiveId(id);
  }

  function jumpTo(target: Element) {
    const container = scrollRef.current;
    if (!container) return;
    const to =
      container.scrollTop +
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24;
    container.scrollTo({ top: to, behavior: "smooth" });
  }

  // Split once per article, not once per keystroke of the Aa control.
  const segments = useMemo(
    () => splitBody(content?.status === "failed" ? "" : (content?.html ?? "")),
    [content]
  );

  // Feeds routinely publish the article's own opening as the summary, and the
  // reader would then print it twice: once in italics as a standfirst, once as
  // the first paragraphs. Shown only when it is actually a different sentence.
  const bodyOpening = segments.find((part) => part.kind === "html");
  const standfirst =
    article.summary && !repeatsBody(article.summary, bodyOpening?.html ?? "")
      ? article.summary
      : null;

  // Related first, then the list, never the article being read, never twice.
  const nextUp = [...related, ...upNext]
    .filter(
      (candidate, index, all) =>
        candidate.id !== article.id &&
        all.findIndex((other) => other.id === candidate.id) === index
    )
    .slice(0, UP_NEXT);

  const minutes = content?.reading_minutes ?? null;
  const left = minutes ? Math.max(0, Math.ceil(minutes * (1 - progress))) : null;
  // Where the text came from. Diagnostic, not reading material, so it sits in
  // the ⋯ menu beside Original — the one place it changes a decision. The
  // 'partial' case is different and stays on the page: "only part of the
  // article" tells you what to do next.
  const sourceNote = content?.source ? SOURCE_LABEL[content.source] : "";
  const hasOutline = (content?.headings.length ?? 0) > 0;
  // Derived rather than stored: with no highlights there is only one list, and
  // the automatic switch is a default the reader can overrule at any time.
  const railTab =
    highlights.length === 0
      ? "article"
      : (railChoice ?? (keptThisSession ? "highlights" : "article"));

  // The same three controls in the same order, drawn either in the popover or
  // in the sheet — one definition, so a change to the ramp cannot land in one
  // and not the other.
  const typeControls = (
    <>
      <p className="mb-2 text-[11px] tracking-[0.12em] text-ink-faint uppercase">
        Text size
      </p>
      <div className="flex rounded-full border border-line p-0.5">
        {TYPE_STEPS.map((size, index) => (
          <button
            key={size}
            onClick={() => changeType({ ...type, step: index })}
            aria-pressed={type.step === index}
            className={`flex-1 rounded-full py-1 pointer-coarse:min-h-13 transition ${
              type.step === index
                ? "bg-ink text-paper"
                : "text-ink-faint hover:text-ink"
            }`}
            style={{ fontSize: `${11 + index * 2}px` }}
          >
            A
          </button>
        ))}
      </div>
      <p className="mt-3 mb-2 text-[11px] tracking-[0.12em] text-ink-faint uppercase">
        Typeface
      </p>
      <div className="flex rounded-full border border-line p-0.5 text-[12px]">
        <button
          onClick={() => changeType({ ...type, serif: true })}
          aria-pressed={type.serif}
          className={`flex-1 rounded-full py-1 pointer-coarse:min-h-13 font-serif transition ${
            type.serif ? "bg-ink text-paper" : "text-ink-faint"
          }`}
        >
          Serif
        </button>
        <button
          onClick={() => changeType({ ...type, serif: false })}
          aria-pressed={!type.serif}
          className={`flex-1 rounded-full py-1 pointer-coarse:min-h-13 transition ${
            type.serif ? "text-ink-faint" : "bg-ink text-paper"
          }`}
        >
          Sans
        </button>
      </div>
      <p className="mt-3 mb-2 text-[11px] tracking-[0.12em] text-ink-faint uppercase">
        Column width
      </p>
      <div className="flex rounded-full border border-line p-0.5 text-[12px]">
        {WIDTH_STEPS.map((option, index) => (
          <button
            key={option.px}
            onClick={() => changeType({ ...type, width: index })}
            aria-pressed={type.width === index}
            className={`flex-1 rounded-full py-1 pointer-coarse:min-h-13 transition ${
              type.width === index
                ? "bg-ink text-paper"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );

  async function clearAll() {
    const doomed = highlights;
    setHighlightsOpen(false);
    if (bodyRef.current) {
      for (const highlight of doomed) unwrapHighlight(bodyRef.current, highlight.id);
    }
    setHighlights([]);
    await Promise.all(doomed.map((highlight) => deleteHighlight(highlight.id)));
    onToast?.(
      `${doomed.length} highlight${doomed.length === 1 ? "" : "s"} removed`
    );
  }

  async function copyAll(markdown: boolean) {
    const text = highlightsAsText(highlights, markdown, {
      title: article.title,
      link: article.link,
    });
    try {
      await navigator.clipboard.writeText(text);
      onToast?.(
        `${highlights.length} highlight${highlights.length === 1 ? "" : "s"} copied`
      );
    } catch {
      onToast?.("Could not reach the clipboard", true);
    }
  }

  // The highlights, in reading order, with their notes. Orphans are grouped at
  // the end: they are still yours, they just cannot be pointed at any more.
  const highlightList = (dense: boolean) => {
    const live = highlights.filter((highlight) => !highlight.orphaned);
    const lost = highlights.filter((highlight) => highlight.orphaned);
    return (
    <div className="flex flex-col gap-3">
      {live.map((highlight) => (
        <button
          key={highlight.id}
          onClick={() => {
            const mark = bodyRef.current?.querySelector(
              `mark[data-hl="${highlight.id}"]`
            );
            if (mark) {
              setHighlightsOpen(false);
              requestAnimationFrame(() => jumpTo(mark));
            }
          }}
          className="group border-l-2 border-clay pl-3 text-left transition pointer-coarse:min-h-11"
        >
          <span
            className={
              dense
                ? "block text-[17.5px] leading-[1.5] text-ink"
                : "line-clamp-3 text-[13px] leading-[1.45] text-ink-soft transition group-hover:text-ink"
            }
          >
            {highlight.quote}
          </span>
          {highlight.note && (
            <span
              className={`mt-[5px] block leading-[1.45] italic text-ink-faint ${
                dense ? "text-[15px]" : "text-[12.5px]"
              }`}
            >
              {highlight.note}
            </span>
          )}
        </button>
      ))}

      {/* In the sheet, orphans get a heading of their own and a Remove — a
          highlight with no mark in the prose has nothing else left to click,
          and one that cannot be deleted is worse than a busy row. In the rail
          they stay a quiet line in the same list, as the design draws them:
          there, Remove appears on hover, which a rail above 1180px always has.
          */}
      {lost.length > 0 && (
        <div className={dense ? "mt-2 border-t border-line pt-3" : "contents"}>
          {dense && (
            <p className="mb-2.5 text-[12px] tracking-[0.1em] text-ink-faint uppercase">
              Not in this version of the article
            </p>
          )}
          <div className={dense ? "flex flex-col gap-3" : "contents"}>
            {lost.map((highlight) => (
              <div
                key={highlight.id}
                className="group border-l-2 border-line pl-3 opacity-70"
              >
                <span
                  className={
                    dense
                      ? "block text-[17.5px] leading-[1.5] text-ink-soft"
                      : "line-clamp-3 text-[13px] leading-[1.45] text-ink-soft"
                  }
                >
                  {highlight.quote}
                </span>
                {highlight.note && (
                  <span
                    className={`mt-[5px] block leading-[1.45] italic text-ink-faint ${
                      dense ? "text-[15px]" : "text-[12.5px]"
                    }`}
                  >
                    {highlight.note}
                  </span>
                )}
                <div className="mt-[5px] flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-ink-faint">
                    {dense
                      ? "the publisher edited the page · the quote is kept"
                      : "not in this version"}
                  </span>
                  <button
                    onClick={() => forget(highlight)}
                    className={`shrink-0 rounded-full px-2 py-1 text-[11.5px] text-clay transition hover:bg-clay-soft ${
                      dense
                        ? "pointer-coarse:min-h-11"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      role="dialog"
      aria-modal="true"
      aria-label={article.title}
      className="fixed inset-0 z-50 overflow-y-auto bg-paper-sunken"
    >
      <div className="sticky top-0 z-10 bg-paper">
        <div className="flex h-16 items-center justify-between gap-4 border-b border-line px-5 md:px-8">
          <button
            onClick={close}
            className="flex min-w-0 items-center gap-2 text-[13px] text-ink-soft transition hover:text-ink"
          >
            <span aria-hidden>←</span>
            <span className="truncate">Back to {originLabel}</span>
          </button>
          <div className="flex shrink-0 items-center gap-2.5">
            <Pill
              onClick={onToggleSave}
              pressed={saved}
              title={saved ? "Remove from Read later" : "Save to Read later"}
            >
              <BookmarkIcon size={13} filled={saved} />
              <span className="hidden sm:inline">
                {saved ? "Saved" : "Read later"}
              </span>
            </Pill>

            <div className="relative">
              <Pill onClick={() => setTypeOpen((open) => !open)} pressed={typeOpen}>
                Aa
              </Pill>
              {typeOpen && !touch && (
                <div className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-line bg-paper-raised p-3 shadow-[0_12px_32px_-16px_rgba(31,30,27,0.35)]">
                  {typeControls}
                </div>
              )}
            </div>

            {/* The source note rides along as the tooltip rather than
                earning a menu of its own: it is diagnostic, and a ⋯ holding a
                single item is a worse answer than no ⋯. */}
            <a
              href={unlockUrl(article.link)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordEvent(article.link, "open")}
              title={
                sourceNote
                  ? `Open the original — this text was ${sourceNote}`
                  : "Open the original"
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-raised px-3 py-1.5 text-[12.5px] text-ink-soft transition hover:border-clay hover:text-clay pointer-coarse:min-h-11 pointer-coarse:px-4"
            >
              <ExternalIcon size={13} />
              <span className="hidden sm:inline">Original</span>
            </a>
            <button
              onClick={close}
              aria-label="Close the reader"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper-raised text-[15px] text-ink-faint transition hover:text-ink"
            >
              ×
            </button>
          </div>
        </div>
        {/* Everything the left rail says, for the widths where there is no
            left rail. Below 1180px the outline, the reading time and the
            saved state all vanished, and nothing else in the component
            printed them. */}
        <div className="flex h-9 items-center gap-3 border-b border-line px-5 text-[12.5px] text-ink-faint md:px-8 min-[1180px]:hidden">
          {hasOutline && (
            <button
              onClick={() => setOutlineOpen(true)}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-paper-sunken px-3 text-ink-soft transition hover:text-ink"
            >
              In this article
              <span className="tabular-nums">{content?.headings.length}</span>
            </button>
          )}
          {/* The same shape in the accent: structure reads as neutral, and
              what you kept reads as yours. */}
          {highlights.length > 0 && (
            <button
              onClick={() => setHighlightsOpen(true)}
              className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-clay-soft px-3 text-clay transition hover:brightness-95"
            >
              Highlights
              <span className="tabular-nums">{highlights.length}</span>
            </button>
          )}
          {minutes && (
            <span className="truncate">
              {minutes} min read{left !== null ? ` · ${left} min left` : ""}
            </span>
          )}
        </div>

        {/* scaleX rather than width: a transform is composited, so the bar
            never asks the page for another layout while you are scrolling. */}
        <div className="h-[3px] bg-line">
          <div
            className="h-[3px] origin-left bg-clay"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>

      <div className="flex justify-center gap-7 px-5 py-8 md:px-10 md:py-11">
        {/* Both rails ride along with the scroll: an outline you have to
            scroll back up to reach is a table of contents, not a position
            indicator. self-start keeps the box its own height, which is what
            sticky needs, and a long outline scrolls inside itself rather than
            running off the bottom of the window. */}
        <aside
          style={{
            top: `${RAIL_TOP}px`,
            maxHeight: `calc(100vh - ${RAIL_TOP + 24}px)`,
          }}
          className="no-scrollbar hidden w-[212px] shrink-0 self-start overflow-y-auto pt-2.5 min-[1180px]:sticky min-[1180px]:block"
        >
          {/* One switch over two lists, not a stack. Stacked, an article with
              fifteen headings pushed the list you made yourself below the fold
              of the rail's own scroller — the first thing to disappear was the
              only thing here that is yours. */}
          {highlights.length > 0 && (
            <Segmented
              options={[
                { value: "article" as const, label: "Article" },
                {
                  value: "highlights" as const,
                  label: (
                    <>
                      Highlights{" "}
                      <span className="tabular-nums opacity-65">
                        {highlights.length}
                      </span>
                    </>
                  ),
                },
              ]}
              value={railTab}
              onChange={setRailChoice}
              ariaLabel="Rail contents"
              className="mb-4 w-full gap-[3px] bg-paper p-[3px]"
              size="rail"
            />
          )}

          {railTab === "article" ? (
            <ReaderOutline
              headings={content?.headings ?? []}
              activeId={activeId}
              onJump={jump}
            />
          ) : (
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
                  In reading order
                </p>
                <button
                  onClick={() => copyAll(false)}
                  className="shrink-0 text-[11.5px] text-clay transition hover:brightness-90"
                >
                  Copy all
                </button>
              </div>
              {highlightList(false)}
            </div>
          )}
          <div
            className={`flex flex-col gap-1 ${
              hasOutline || highlights.length > 0
                ? "mt-[22px] border-t border-line pt-[14px]"
                : ""
            }`}
          >
            {minutes && (
              <span className="text-[12.5px] text-ink-faint">
                {minutes} min read{left !== null ? ` · ${left} min left` : ""}
              </span>
            )}
            <span className="text-[12.5px] text-ink-faint">
              {saved ? "Saved to Read later" : "Not saved"}
            </span>
            {content?.status === "partial" && (
              <span className="text-[12.5px] leading-[1.5] text-ink-faint">
                only part of the article — the page gave up no more
              </span>
            )}
          </div>
        </aside>

        <article
          // Not shrink-0: at the widest setting a 1280px window has to be
          // allowed to take the difference out of the column rather than
          // pushing a rail off screen.
          //
          // In portrait on a touch screen the width steps do not apply: the
          // sheet is the column, minus its gutters, which comes out around
          // sixty-six characters at these sizes.
          style={{
            maxWidth:
              touch && portrait ? undefined : `${WIDTH_STEPS[type.width].px}px`,
          }}
          className="w-full rounded-2xl border border-line bg-paper px-6 py-9 md:px-16 md:py-13"
        >
          <div className="mb-4.5 flex items-center gap-2.5">
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full font-serif text-[12px] text-white"
              style={{ backgroundColor: feedTone(article.feed_id) }}
            >
              {article.feed_title.trim().charAt(0).toUpperCase()}
            </span>
            <span className="text-[13px] text-ink-faint">
              {article.feed_title}
              {article.published_at && (
                <>
                  <span className="mx-1.5">·</span>
                  {timeAgo(article.published_at)}
                </>
              )}
            </span>
          </div>
          <h1 className="font-serif text-[30px] leading-[1.18] font-medium text-pretty text-ink md:text-[38px] pointer-coarse:portrait:text-[40px] pointer-coarse:landscape:text-[36px]">
            {article.title}
          </h1>
          {standfirst && (
            <p className="mt-5 font-serif text-[19px] leading-[1.5] text-ink-soft italic pointer-coarse:portrait:text-[21px] pointer-coarse:landscape:text-[20px]">
              {standfirst}
            </p>
          )}
          <div className="my-8 h-px bg-line" />

          {loading ? (
            <Skeleton />
          ) : content && content.status !== "failed" && segments.length > 0 ? (
            <div
              ref={bodyRef}
              className={`${type.serif ? "font-serif" : "font-sans"} ${
                ticks.length > 0 ? "relative" : ""
              }`}
              style={{
                fontSize: `${TYPE_STEPS[type.step]}px`,
                lineHeight: touch ? 1.7 : undefined,
              }}
            >
              {segments.map((segment, at) =>
                segment.kind === "gallery" ? (
                  <ReaderGallery
                    key={at}
                    slides={segment.slides}
                    onOpen={(index) =>
                      setLightbox({
                        items: segment.slides.map((slide) => ({
                          src: slide.full
                            ? cachedImageUrl(slide.full)
                            : slide.src,
                          caption: slide.caption,
                        })),
                        index,
                      })
                    }
                  />
                ) : (
                  <ArticleHtml key={at} html={segment.html} />
                )
              )}
              {/* Where the others are, without opening anything. Ticks are
                  positions on the page rather than in the text, so they are
                  measured from the marks themselves. */}
              {ticks.length > 0 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-0 -left-4 h-full w-[3px] md:-left-10"
                >
                  {ticks.map((tick) => {
                    const here =
                      progress >= tick.top - 0.01 &&
                      progress <= tick.top + tick.height + 0.05;
                    return (
                      <button
                        key={tick.id}
                        onClick={() => {
                          const mark = bodyRef.current?.querySelector(
                            `mark[data-hl="${tick.id}"]`
                          );
                          if (mark) jumpTo(mark);
                        }}
                        tabIndex={-1}
                        aria-hidden
                        style={{
                          top: `${tick.top * 100}%`,
                          height: `max(12px, ${tick.height * 100}%)`,
                        }}
                        className={`absolute w-[3px] rounded-sm transition-colors pointer-events-auto pointer-coarse:pointer-events-none ${
                          here ? "bg-clay" : "bg-line"
                        }`}
                      />
                    );
                  })}
                </div>
              )}
              {content.status === "partial" && (
                <Partial onRetry={() => load(true)} link={article.link} />
              )}
            </div>
          ) : (
            <Failed onRetry={() => load(true)} link={article.link} />
          )}
          {/* Below xl there is no Up next rail, and finishing an article
              should not end the session — so it lands where the article ends,
              along with the two actions that were only in the header. */}
          {nextUp.length > 0 && (
            <div className="mt-10 border-t border-line pt-6 xl:hidden">
              <ReaderUpNext
                items={nextUp}
                onOpen={onOpenArticle}
                layout="grid"
              />
            </div>
          )}
          <div className="mt-8 flex gap-2.5 xl:hidden">
            <button
              onClick={onToggleSave}
              className={`flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full border text-[15px] transition ${
                saved
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              <BookmarkIcon size={15} filled={saved} />
              {saved ? "Saved" : "Read later"}
            </button>
            <a
              href={unlockUrl(article.link)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordEvent(article.link, "open")}
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full border border-line bg-paper-raised text-[15px] text-ink-soft transition"
            >
              <ExternalIcon size={15} /> Original
            </a>
          </div>
        </article>

        <aside
          style={{
            top: `${RAIL_TOP}px`,
            maxHeight: `calc(100vh - ${RAIL_TOP + 24}px)`,
          }}
          className="no-scrollbar hidden w-[212px] shrink-0 self-start overflow-y-auto pt-2.5 xl:sticky xl:block"
        >
          <ReaderUpNext items={nextUp} onOpen={onOpenArticle} />
        </aside>
      </div>

      <Sheet open={typeOpen && touch} onClose={() => setTypeOpen(false)} title="Text">
        <div className="pb-4">{typeControls}</div>
      </Sheet>

      {pending_ && draft === null && (
        <ReaderHighlightPopover
          at={pending_.at}
          existing={pending_.highlight !== null}
          hasNote={Boolean(pending_.highlight?.note)}
          below={touch}
          onHighlight={() => keep(null)}
          onNote={() => setDraft(pending_.highlight?.note ?? "")}
          onDelete={
            pending_.highlight ? () => forget(pending_.highlight!) : undefined
          }
          onClose={clearPending}
        />
      )}
      {pending_ && draft !== null && (
        <ReaderNoteEditor
          at={pending_.at}
          quote={pending_.highlight?.quote ?? pending_.anchor?.quote ?? ""}
          draft={draft}
          onDraft={setDraft}
          touch={touch}
          below={touch}
          onSave={() => {
            const note = draft.trim();
            if (pending_.highlight) annotate(pending_.highlight, note);
            else keep(note || null);
          }}
          onCancel={() => setDraft(null)}
          onDelete={
            pending_.highlight ? () => forget(pending_.highlight!) : undefined
          }
        />
      )}

      <Sheet
        open={highlightsOpen && !wide}
        onClose={() => setHighlightsOpen(false)}
      >
        <div className="-mx-5 flex items-center gap-2 border-b border-line px-5 pb-3">
          <h2 className="min-w-0 flex-1 font-serif text-[22px] text-ink">
            Highlights <span className="tabular-nums">· {highlights.length}</span>
          </h2>
          <button
            onClick={() => copyAll(false)}
            className="min-h-11 shrink-0 rounded-full border border-line bg-paper-raised px-4 text-[13.5px] text-ink-soft transition hover:border-clay hover:text-clay"
          >
            Copy all
          </button>
          <Menu
            items={[
              {
                label: "Copy as Markdown",
                onSelect: () => copyAll(true),
              },
              separator("clear"),
              {
                label: "Clear all",
                hint: "Removes every highlight in this article",
                destructive: true,
                onSelect: () => {
                  if (
                    window.confirm(
                      `Remove all ${highlights.length} highlights from this article?`
                    )
                  ) {
                    void clearAll();
                  }
                },
              },
            ]}
          />
        </div>
        <div className="pt-4 pb-4">{highlightList(true)}</div>
      </Sheet>

      {/* The outline, where the rail cannot be. Closes before jumping: jump()
          animates the overlay's own scroller, and racing it against the
          sheet's transition makes both look broken. */}
      <Sheet
        open={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        title="In this article"
      >
        {minutes && (
          <p className="mb-3 text-[13px] text-ink-faint">
            {minutes} min read{left !== null ? ` · ${left} min left` : ""}
          </p>
        )}
        <div className="pb-4">
          {(content?.headings ?? []).map((heading) => (
            <button
              key={heading.id}
              onClick={() => {
                setOutlineOpen(false);
                requestAnimationFrame(() => jump(heading.id));
              }}
              style={{ paddingLeft: `${(heading.level - 2) * 10}px` }}
              className={`flex min-h-14 w-full items-center border-l text-left text-[15.5px] transition ${
                activeId === heading.id
                  ? "border-clay font-medium text-ink"
                  : "border-line text-ink-soft"
              }`}
            >
              <span className="pl-3.5">{heading.text}</span>
            </button>
          ))}
        </div>
      </Sheet>

      {lightbox && (
        <Lightbox
          state={lightbox}
          onStep={(by) => setLightbox(step(lightbox, by))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// Wraps around, so the arrows never dead-end in the middle of a set.
function step(state: Lightbox, by: number): Lightbox {
  const count = state.items.length;
  return { ...state, index: (state.index + by + count) % count };
}

function Lightbox({
  state,
  onStep,
  onClose,
}: {
  state: Lightbox;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  const item = state.items[state.index];
  const many = state.items.length > 1;
  return (
    // Above the reader, which is already above the grid. Clicking the ground
    // closes — the picture itself and the controls stop the click.
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || "Image"}
      className="fixed inset-0 z-60 flex flex-col items-center justify-center gap-4 bg-ink/85 px-4 py-6 backdrop-blur-sm"
    >
      <button
        onClick={onClose}
        aria-label="Close the image"
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-paper/90 text-[17px] text-ink transition hover:bg-paper"
      >
        ×
      </button>

      {many && (
        <>
          <LightboxArrow side="left" onClick={() => onStep(-1)} />
          <LightboxArrow side="right" onClick={() => onStep(1)} />
        </>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.src}
        alt={item.caption}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[82vh] max-w-full rounded-lg object-contain"
      />
      {(item.caption || many) && (
        <p
          onClick={(event) => event.stopPropagation()}
          className="flex max-w-[720px] gap-2.5 text-center text-[13px] leading-[1.5] text-paper/80"
        >
          {many && (
            <span className="shrink-0 tabular-nums">
              {state.index + 1}/{state.items.length}
            </span>
          )}
          <span>{item.caption}</span>
        </p>
      )}
    </div>
  );
}

function LightboxArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      className={`absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-paper/90 text-ink transition hover:bg-paper ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={side === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

// Where the marks sit, as fractions of the body's height. Read from the DOM
// rather than from the anchor offsets: an offset is a position in the text, and
// the gutter is about the position on the page.
function measureTicks(
  body: HTMLElement,
  ids: number[]
): Array<{ id: number; top: number; height: number }> {
  const total = body.scrollHeight;
  if (total <= 0) return [];
  const ticks: Array<{ id: number; top: number; height: number }> = [];
  for (const id of ids) {
    const marks = [...body.querySelectorAll(`mark[data-hl="${id}"]`)];
    if (marks.length === 0) continue;
    const first = marks[0] as HTMLElement;
    const last = marks[marks.length - 1] as HTMLElement;
    const top = first.offsetTop;
    const bottom = last.offsetTop + last.offsetHeight;
    ticks.push({ id, top: top / total, height: (bottom - top) / total });
  }
  return ticks.sort((a, b) => a.top - b.top);
}

// A run of the article's prose, written into the DOM once.
//
// Not dangerouslySetInnerHTML: highlights are <mark> elements applied to these
// text nodes after mount, and React re-renders this subtree on state it knows
// nothing about — measured, not assumed: a selection produced a re-render that
// replaced all 99 children of a body div and took the marks with it. Writing
// the html in an effect keyed on the html itself means React owns the empty
// container and nothing else, so a mark survives until the article changes.
//
// The html was sanitised against a tag and attribute allowlist before it was
// ever stored (sanitizeArticleHtml in src/lib/extract.ts); nothing that can
// execute survives it.
function ArticleHtml({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) host.current.innerHTML = html;
  }, [html]);
  return <div ref={host} className="reader-body" />;
}

function Pill({
  children,
  onClick,
  pressed,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className={`flex items-center gap-[7px] rounded-full border px-3.5 py-[7px] text-[13px] transition ${
        pressed
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paper-raised text-ink-soft hover:border-clay hover:text-clay"
      }`}
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[11, 12, 10, 12, 8, 12, 11, 6].map((width, index) => (
        <div
          key={index}
          className="h-4 rounded bg-paper-sunken"
          style={{ width: `${(width / 12) * 100}%` }}
        />
      ))}
    </div>
  );
}

// A body that came through, but probably isn't all of it. Shown under the
// text rather than in place of it — there is something to read, and the point
// is to offer a way on rather than to apologise.
function Partial({ onRetry, link }: { onRetry: () => void; link: string }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper-sunken px-5 py-4">
      <p className="min-w-[220px] flex-1 font-sans text-[13px] leading-[1.55] text-ink-soft">
        That may be all the page gave up — it looks shorter than a full
        article.
      </p>
      <button
        onClick={onRetry}
        className="rounded-full bg-clay px-4 py-2 font-sans text-[13px] font-medium text-white transition hover:brightness-95"
      >
        Try again
      </button>
      <a
        href={unlockUrl(link)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] text-ink-soft transition hover:border-clay hover:text-clay"
      >
        Open the original
      </a>
    </div>
  );
}

function Failed({ onRetry, link }: { onRetry: () => void; link: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="font-serif text-xl text-ink">Couldn’t fetch the text</p>
      <p className="max-w-sm text-[13px] leading-[1.6] text-ink-soft">
        The publisher’s page, its print edition and both unlock routes all came
        back empty. The article itself is still there.
      </p>
      <div className="mt-1 flex gap-2">
        <button
          onClick={onRetry}
          className="rounded-full bg-clay px-4 py-2 text-[13px] font-medium text-white transition hover:brightness-95"
        >
          Try again
        </button>
        <a
          href={unlockUrl(link)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition hover:border-clay hover:text-clay"
        >
          Open the original
        </a>
      </div>
    </div>
  );
}
