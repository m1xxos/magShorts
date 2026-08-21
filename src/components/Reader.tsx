"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ArticleContentDto,
  type ArticleDto,
  feedTone,
  timeAgo,
} from "@/lib/types";
import { cachedImageUrl, recordEvent, unlockUrl } from "@/lib/actions";
import { BookmarkIcon, ExternalIcon } from "./SwipeableCard";
import { ReaderGallery, type Slide } from "./ReaderGallery";
import { ReaderOutline } from "./ReaderOutline";
import { ReaderUpNext } from "./ReaderUpNext";

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
// How many cards the right rail holds. Exported because each page builds
// its own list-order fallback and both have to agree on the length.
export const UP_NEXT = 3;
const PROGRESS_KEY = "ms_read_progress";
const TYPE_KEY = "ms_reader_type";
// Clears the sticky top bar (64px) and the progress rule (3px), plus a little
// air. Used by both rails and by the outline's own scroll box.
const RAIL_TOP = 83;

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

function writeProgress(articleId: number, fraction: number): void {
  const stored = readProgress();
  stored[String(articleId)] = fraction;
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(stored));
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

function readProgress(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "{}");
  } catch {
    return {};
  }
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
  const [lightbox, setLightbox] = useState<Lightbox | null>(null);
  // Articles about the same thing as this one. Empty is a normal answer.
  const [related, setRelated] = useState<ArticleDto[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Highest fraction reached, not the current one: scrolling back up should
  // not un-read the article.
  const reached = useRef(0);
  const ticking = useRef(false);
  const pending = useRef(0);
  const persistTimer = useRef<number | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(TYPE_KEY);
    if (!saved) return;
    try {
      // Read field by field: settings stored before the width control existed
      // should keep their size and typeface rather than being thrown away.
      const parsed = JSON.parse(saved) as Partial<TypeSetting>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
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

  // Click any picture to see it properly. Delegated from the body, because the
  // article arrives as an HTML string and there is nothing to hang an onClick
  // on. An image wrapped in a link to somewhere that isn't an image file is
  // left alone — that is a real link and it should still go there.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !content?.html) return;

    function onClick(event: MouseEvent) {
      const image = (event.target as HTMLElement | null)?.closest?.("img");
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
  }, [content]);

  // Animated rather than scrollIntoView: the overlay is the scroll container,
  // and scrollIntoView also scrolls whatever ancestor it feels like.
  function jump(id: string) {
    const container = scrollRef.current;
    const target = bodyRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (!container || !target) return;
    const to =
      container.scrollTop +
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      24;
    container.scrollTo({ top: to, behavior: "smooth" });
    setActiveId(id);
  }

  // Split once per article, not once per keystroke of the Aa control.
  const segments = useMemo(
    () => splitBody(content?.status === "ok" ? (content.html ?? "") : ""),
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
  const note = content?.source ? SOURCE_LABEL[content.source] : "";
  const hasOutline = (content?.headings.length ?? 0) > 0;

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
              {typeOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-line bg-paper-raised p-3 shadow-[0_12px_32px_-16px_rgba(31,30,27,0.35)]">
                  <p className="mb-2 text-[11px] tracking-[0.12em] text-ink-faint uppercase">
                    Text size
                  </p>
                  <div className="flex rounded-full border border-line p-0.5">
                    {TYPE_STEPS.map((size, index) => (
                      <button
                        key={size}
                        onClick={() => changeType({ ...type, step: index })}
                        aria-pressed={type.step === index}
                        className={`flex-1 rounded-full py-1 transition ${
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
                      className={`flex-1 rounded-full py-1 font-serif transition ${
                        type.serif ? "bg-ink text-paper" : "text-ink-faint"
                      }`}
                    >
                      Serif
                    </button>
                    <button
                      onClick={() => changeType({ ...type, serif: false })}
                      aria-pressed={!type.serif}
                      className={`flex-1 rounded-full py-1 transition ${
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
                        className={`flex-1 rounded-full py-1 transition ${
                          type.width === index
                            ? "bg-ink text-paper"
                            : "text-ink-faint hover:text-ink"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <a
              href={unlockUrl(article.link)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-[7px] rounded-full border border-line bg-paper-raised px-3.5 py-[7px] text-[13px] text-ink-soft transition hover:border-clay hover:text-clay"
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
          className="no-scrollbar hidden w-[212px] shrink-0 self-start overflow-y-auto pt-2.5 xl:sticky xl:block"
        >
          <ReaderOutline
            headings={content?.headings ?? []}
            activeId={activeId}
            onJump={jump}
          />
          <div
            className={`flex flex-col gap-2 ${
              hasOutline ? "mt-7 border-t border-line pt-4" : ""
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
            {note && (
              <span className="text-[12.5px] leading-[1.5] text-ink-faint">
                {note}
              </span>
            )}
          </div>
        </aside>

        <article
          // Not shrink-0: at the widest setting a 1280px window has to be
          // allowed to take the difference out of the column rather than
          // pushing a rail off screen.
          style={{ maxWidth: `${WIDTH_STEPS[type.width].px}px` }}
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
          <h1 className="font-serif text-[30px] leading-[1.18] font-medium text-pretty text-ink md:text-[38px]">
            {article.title}
          </h1>
          {standfirst && (
            <p className="mt-5 font-serif text-[19px] leading-[1.5] text-ink-soft italic">
              {standfirst}
            </p>
          )}
          <div className="my-8 h-px bg-line" />

          {loading ? (
            <Skeleton />
          ) : content?.status === "ok" && segments.length > 0 ? (
            <div
              ref={bodyRef}
              className={type.serif ? "font-serif" : "font-sans"}
              style={{ fontSize: `${TYPE_STEPS[type.step]}px` }}
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
                  <div
                    key={at}
                    className="reader-body"
                    // Sanitised server-side against a tag and attribute
                    // allowlist before it was ever stored
                    // (sanitizeArticleHtml in src/lib/extract.ts); nothing
                    // that can execute survives it.
                    dangerouslySetInnerHTML={{ __html: segment.html }}
                  />
                )
              )}
            </div>
          ) : (
            <Failed onRetry={() => load(true)} link={article.link} />
          )}
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
