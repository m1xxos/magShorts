"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { recordEvent } from "@/lib/actions";
import { type ArticleDto, type FolderDto } from "@/lib/types";
import { ShortCard } from "./ShortCard";
import {
  BookmarkIcon,
  ExternalIcon,
  OmnivoreIcon,
  type SwipeableCardHandle,
} from "./SwipeableCard";
import { Toast, useToast } from "./Toast";
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
  }, []);

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
          {articles.length > 0 && (
            <span className="rounded-full border border-line bg-paper-raised/90 px-3.5 py-2 text-[13px] tabular-nums text-ink-faint backdrop-blur">
              {current + 1} / {articles.length}
            </span>
          )}
        </div>
      </div>

      {/* Folder deck switcher (algorithmic mode only) */}
      {!feedParam && folders.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-[4.25rem] z-30 flex justify-center md:top-5">
          <div className="pointer-events-auto no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-paper-raised/90 p-1 backdrop-blur">
            <button
              onClick={() => setFolderId(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition ${
                folderId === null
                  ? "bg-clay text-white"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              All
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setFolderId(folder.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition ${
                  folderId === folder.id
                    ? "bg-clay text-white"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {folder.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prev / next arrows */}
      {articles.length > 0 && (
        <div className="absolute right-5 bottom-5 z-30 hidden flex-col gap-2 md:flex">
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
              onActed={() => actedCards.current.add(index)}
              ref={(handle) => {
                if (handle) cardHandles.current.set(index, handle);
                else cardHandles.current.delete(index);
              }}
            />
          ))}
        </div>
      )}

      {/* Legend for buttons and keyboard shortcuts */}
      {articles.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center md:hidden">
          <div className="flex items-center gap-2 rounded-full border border-line bg-paper-raised/90 px-4 py-2 text-[12px] text-ink-faint backdrop-blur">
            swipe <BookmarkIcon size={12} /> save →
            <Dot />← <OmnivoreIcon size={12} /> Omnivore
          </div>
        </div>
      )}
      {articles.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 hidden justify-center md:flex">
          <div className="flex items-center gap-4 rounded-full border border-line bg-paper-raised/90 px-5 py-2.5 text-[12px] text-ink-faint backdrop-blur">
            <span className="flex items-center gap-1.5">
              <Key>↑</Key>
              <Key>↓</Key> browse
            </span>
            <Dot />
            <span className="flex items-center gap-1.5">
              <BookmarkIcon size={12} /> or <Key>→</Key> read later
            </span>
            <Dot />
            <span className="flex items-center gap-1.5">
              <OmnivoreIcon size={12} /> or <Key>←</Key> send to Omnivore
            </span>
            <Dot />
            <span className="flex items-center gap-1.5">
              <ExternalIcon size={12} /> open the original
            </span>
            <Dot />
            <span className="flex items-center gap-1.5">
              <Key>Esc</Key> exit
            </span>
          </div>
        </div>
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
