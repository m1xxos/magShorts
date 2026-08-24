"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  recordEvent,
  removeFromReadingList,
  saveToReadingList,
} from "@/lib/actions";
import { type ArticleDto, type FolderDto } from "@/lib/types";
import { ShortCard } from "./ShortCard";
import {
  BookmarkIcon,
  type SwipeableCardHandle,
} from "./SwipeableCard";
import { Toast, useToast } from "./Toast";
import { Reader, after } from "./Reader";
import { useReader } from "@/lib/useReader";
import { useUser } from "@/lib/useUser";

const SHORTS_PAGE = 40;

export function ShortsReader() {
  const user = useUser();
  const { toast, showToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedParam = searchParams.get("feed");

  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(0);
  const [readingCount, setReadingCount] = useState(0);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  // null = All: the default deck across every enabled feed and folder.
  const [folderId, setFolderId] = useState<number | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  // Links already saved, so the reader's bookmark pill starts in the right
  // state — the deck knows about saves the moment a card is swiped.
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const [openInReader, setOpenInReader] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardHandles = useRef<Map<number, SwipeableCardHandle>>(new Map());
  const actedCards = useRef<Set<number>>(new Set());
  const skippedCards = useRef<Set<number>>(new Set());
  const viewedCards = useRef<Set<number>>(new Set());
  const prevIndex = useRef(0);
  const enteredAt = useRef(0);

  // Every card that becomes current is marked seen (weightless "view" event),
  // so the next Shorts session starts with articles you haven't been shown.
  useEffect(() => {
    const article = articles[current];
    if (!article || viewedCards.current.has(current)) return;
    viewedCards.current.add(current);
    recordEvent(article.link, "view");
  }, [current, articles]);

  // Dwell time on a card the user scrolled past without touching:
  // a quick pass (2–15s) is a weak negative, lingering ≥15s means they
  // likely read it — a positive signal.
  useEffect(() => {
    if (enteredAt.current === 0) enteredAt.current = Date.now();
    const previous = prevIndex.current;
    if (previous === current) return;
    const dwellMs = Date.now() - enteredAt.current;
    const article = articles[previous];
    if (
      article &&
      dwellMs >= 2000 &&
      !actedCards.current.has(previous) &&
      !skippedCards.current.has(previous)
    ) {
      skippedCards.current.add(previous);
      recordEvent(article.link, dwellMs >= 15_000 ? "dwell" : "skip");
    }
    prevIndex.current = current;
    enteredAt.current = Date.now();
  }, [current, articles]);

  const hasMore = useRef(true);
  const loadingMore = useRef(false);

  // Folder pills only make sense for the algorithmic deck, not a feed filter.
  useEffect(() => {
    if (!user || feedParam) return;
    fetch("/api/folders")
      .then((response) => response.json())
      .then((data: FolderDto[]) => {
        if (Array.isArray(data)) setFolders(data);
      })
      .catch(() => {});
  }, [user, feedParam]);

  useEffect(() => {
    if (!user) return;
    // Switching decks (mount or folder pill) starts a fresh session:
    // drop cards and per-card bookkeeping.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deck reset before an async fetch, same pattern as the data loads below
    setLoading(true);
    setArticles([]);
    setCurrent(0);
    viewedCards.current.clear();
    skippedCards.current.clear();
    actedCards.current.clear();
    prevIndex.current = 0;
    enteredAt.current = 0;
    hasMore.current = true;
    // Default Shorts has its own algorithm (today → week with older inserts
    // → tail). A feed filter stays chronological.
    const url = feedParam
      ? `/api/articles?feed=${feedParam}&limit=${SHORTS_PAGE}`
      : `/api/shorts?limit=${SHORTS_PAGE}${folderId ? `&folder=${folderId}` : ""}`;
    fetch(url)
      .then((response) => response.json())
      .then((data: ArticleDto[] | { articles: ArticleDto[] }) => {
        const page = Array.isArray(data) ? data : (data.articles ?? []);
        hasMore.current = page.length === SHORTS_PAGE;
        setArticles(page);
      })
      .finally(() => setLoading(false));
  }, [user, feedParam, folderId]);

  // Fetch the next page when the user is a few cards from the end.
  // Recommendations are re-requested without an offset: view events shift the
  // candidate set while scrolling, so we just take the current top and drop
  // ids we already show.
  useEffect(() => {
    if (loading || articles.length === 0) return;
    if (current < articles.length - 4) return;
    if (loadingMore.current || !hasMore.current) return;
    loadingMore.current = true;
    const url = feedParam
      ? `/api/articles?feed=${feedParam}&limit=${SHORTS_PAGE}&offset=${articles.length}`
      : `/api/shorts?limit=${SHORTS_PAGE}${folderId ? `&folder=${folderId}` : ""}`;
    fetch(url)
      .then((response) => response.json())
      .then((data: ArticleDto[] | { articles: ArticleDto[] }) => {
        const page = Array.isArray(data) ? data : (data.articles ?? []);
        setArticles((previous) => {
          const seen = new Set(previous.map((article) => article.id));
          const fresh = page.filter((article) => !seen.has(article.id));
          hasMore.current = feedParam
            ? page.length === SHORTS_PAGE
            : fresh.length > 0;
          return [...previous, ...fresh];
        });
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [current, articles.length, loading, feedParam, folderId]);

  const loadReadingCount = useCallback(async () => {
    const response = await fetch("/api/reading-list");
    const items = await response.json();
    setReadingCount(Array.isArray(items) ? items.length : 0);
    setSavedLinks(
      new Set(
        Array.isArray(items)
          ? (items as Array<{ link: string }>).map((item) => item.link)
          : []
      )
    );
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then((settings: { open_in_reader?: string }) => {
        setOpenInReader(settings.open_in_reader !== "off");
      })
      .catch(() => {});
  }, []);

  // The deck already holds every article it can offer, so opening one is a
  // lookup rather than a request; a pasted ?article= link falls back to the
  // API the same way the other pages do.
  const resolveArticle = useCallback(
    async (id: number): Promise<ArticleDto | null> => {
      const known = articles.find((article) => article.id === id);
      if (known) return known;
      const response = await fetch(`/api/articles/${id}`);
      return response.ok ? ((await response.json()) as ArticleDto) : null;
    },
    [articles]
  );
  const reader = useReader(resolveArticle);

  async function toggleSave(article: ArticleDto) {
    const saved = savedLinks.has(article.link);
    const result = saved
      ? await removeFromReadingList(article.link)
      : await saveToReadingList(article);
    showToast(result.message, !result.ok);
    if (result.ok) loadReadingCount();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    loadReadingCount();
  }, [loadReadingCount]);

  const scrollToIndex = useCallback((index: number) => {
    containerRef.current?.children[index]?.scrollIntoView({
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "j" || event.key === " ") {
        event.preventDefault();
        setCurrent((index) => {
          const next = Math.min(index + 1, articles.length - 1);
          scrollToIndex(next);
          return next;
        });
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setCurrent((index) => {
          const prev = Math.max(index - 1, 0);
          scrollToIndex(prev);
          return prev;
        });
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        cardHandles.current
          .get(current)
          ?.swipe(event.key === "ArrowRight" ? "right" : "left");
        // Let the fly-out play, then move on to the next short.
        const next = Math.min(current + 1, articles.length - 1);
        if (next !== current) {
          setTimeout(() => scrollToIndex(next), 320);
        }
      } else if (event.key === "Escape") {
        router.push("/");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [articles.length, current, scrollToIndex, router]);

  // Track which card is in view while the user scrolls freely.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || articles.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number(
              (entry.target as HTMLElement).dataset.index ?? 0
            );
            setCurrent(index);
          }
        }
      },
      { root: container, threshold: 0.6 }
    );
    for (const child of container.children) observer.observe(child);
    return () => observer.disconnect();
  }, [articles]);

  return (
    <div className="relative h-dvh bg-paper">
      {/* Floating header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between p-5">
        <Link
          href="/"
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-paper-raised/90 px-4 py-2 text-sm text-ink-soft backdrop-blur transition hover:text-ink"
        >
          ← <span className="font-serif">magShorts</span>
        </Link>
        {/* The folder pills used to have a floating row of their own directly
            under this one, which cost the card about 50px. */}
        {!feedParam && folders.length > 0 && (
          <div className="pointer-events-auto no-scrollbar mx-3 flex min-w-0 flex-1 justify-center gap-1 overflow-x-auto">
            <button
              onClick={() => setFolderId(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap backdrop-blur transition pointer-coarse:min-h-11 ${
                folderId === null
                  ? "bg-clay text-white"
                  : "border border-line bg-paper-raised/90 text-ink-soft hover:text-ink"
              }`}
            >
              All
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setFolderId(folder.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap backdrop-blur transition pointer-coarse:min-h-11 ${
                  folderId === folder.id
                    ? "bg-clay text-white"
                    : "border border-line bg-paper-raised/90 text-ink-soft hover:text-ink"
                }`}
              >
                {folder.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Link
            id="shorts-read-later"
            href="/reading-list"
            title="Read later"
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-paper-raised/90 px-3.5 py-2 text-[13px] text-ink-soft backdrop-blur transition hover:text-clay"
          >
            <BookmarkIcon size={13} />
            <span className="tabular-nums">{readingCount}</span>
          </Link>
          {/* The full shortcut list lives here now; the legend below is
              three lines long and this is where the rest went. */}
          <button
            onClick={() => setKeysOpen((open) => !open)}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            className="pointer-events-auto hidden h-9 w-9 items-center justify-center rounded-full border border-line bg-paper-raised/90 text-[13px] text-ink-faint backdrop-blur transition hover:text-ink md:flex"
          >
            ?
          </button>
        </div>
      </div>

      {/* Where you are in the deck, as a rail rather than "7 / 40" — a
          fraction of a number that grows as pages load is not a position. */}
      {articles.length > 0 && (
        <div className="pointer-events-none absolute top-1/2 left-4 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 md:flex">
          <span className="text-[11px] tabular-nums text-ink-faint">
            {current + 1}
          </span>
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: Math.min(5, articles.length) }, (_, tick) => {
              const at = Math.round(
                (tick / Math.max(1, Math.min(5, articles.length) - 1)) *
                  (articles.length - 1)
              );
              const near = Math.abs(at - current) < articles.length / 10;
              return (
                <span
                  key={tick}
                  className={`w-[3px] rounded-full transition-all ${
                    near ? "h-6 bg-clay" : "h-3 bg-line"
                  }`}
                />
              );
            })}
          </div>
          <span className="text-[11px] tabular-nums text-ink-faint">
            {articles.length}
          </span>
        </div>
      )}

      {/* Prev / next arrows */}
      {articles.length > 0 && (
        <div className="absolute right-5 bottom-5 z-30 hidden flex-col gap-2 md:flex pointer-coarse:hidden">
          <button
            aria-label="Previous article"
            onClick={() => scrollToIndex(Math.max(current - 1, 0))}
            disabled={current === 0}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-soft transition hover:text-ink disabled:opacity-40"
          >
            ↑
          </button>
          <button
            aria-label="Next article"
            onClick={() => scrollToIndex(Math.min(current + 1, articles.length - 1))}
            disabled={current >= articles.length - 1}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-soft transition hover:text-ink disabled:opacity-40"
          >
            ↓
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-full items-center justify-center">
          <p className="font-serif text-lg text-ink-faint">
            Gathering your articles…
          </p>
        </div>
      ) : articles.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <p className="font-serif text-xl text-ink">
            {feedParam ? "No articles yet" : "You’re all caught up"}
          </p>
          {!feedParam && (
            <p className="max-w-xs text-center text-sm text-ink-faint">
              You’ve seen everything fresh — come back a bit later.
            </p>
          )}
          <Link href="/" className="text-sm text-clay hover:underline">
            Back to your subscriptions
          </Link>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="no-scrollbar h-full snap-y snap-mandatory overflow-y-auto"
        >
          {articles.map((article, index) => (
            <ShortCard
              key={article.id}
              article={article}
              index={index}
              onToast={showToast}
              onSaved={loadReadingCount}
              onRead={openInReader ? reader.open : undefined}
              onActed={() => actedCards.current.add(index)}
              ref={(handle) => {
                if (handle) cardHandles.current.set(index, handle);
                else cardHandles.current.delete(index);
              }}
            />
          ))}
        </div>
      )}

      {/* Three shortcuts, not five, and out of the middle of the screen.
          The rest are behind the ? in the header — a legend you have read once
          should not keep taking the bottom of every card. */}
      {articles.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center md:hidden">
          <div className="rounded-full border border-line bg-paper-raised/90 px-4 py-2 text-[12px] text-ink-faint backdrop-blur">
            Swipe up for the next · swipe right to save
          </div>
        </div>
      )}
      {articles.length > 0 && (
        <div className="pointer-events-none absolute bottom-5 left-5 z-30 hidden md:block">
          <div className="flex items-center gap-3 rounded-full border border-line bg-paper-raised/90 px-4 py-2 text-[12px] text-ink-faint backdrop-blur">
            <span className="flex items-center gap-1.5">
              <Key>↑</Key>
              <Key>↓</Key> browse
            </span>
            <Dot />
            <span className="flex items-center gap-1.5">
              <Key>→</Key> save
            </span>
            <Dot />
            <span className="flex items-center gap-1.5">
              <Key>Esc</Key> exit
            </span>
          </div>
        </div>
      )}
      {keysOpen && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm"
          onClick={() => setKeysOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-paper-raised p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="font-serif text-[19px] text-ink">Shortcuts</h2>
            <ul className="mt-3 space-y-2 text-[13px] text-ink-soft">
              <li className="flex items-center gap-2">
                <Key>↑</Key>
                <Key>↓</Key> browse the deck
              </li>
              <li className="flex items-center gap-2">
                <Key>→</Key> save to Read later
              </li>
              <li className="flex items-center gap-2">
                <Key>←</Key> send to Omnivore
              </li>
              <li className="flex items-center gap-2">
                <Key>Esc</Key> back to the feed
              </li>
            </ul>
          </div>
        </div>
      )}
      {reader.article && (
        <Reader
          article={reader.article}
          originLabel="Shorts"
          upNext={after(
            articles,
            articles.findIndex((article) => article.id === reader.article?.id)
          )}
          saved={savedLinks.has(reader.article.link)}
          onToggleSave={() => toggleSave(reader.article!)}
          onOpenArticle={reader.open}
          onClose={reader.close}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] text-ink-soft">
      {children}
    </kbd>
  );
}

function Dot() {
  return <span className="text-line">·</span>;
}
