"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ArticleDto } from "@/lib/types";
import { ShortCard } from "./ShortCard";
import {
  BookmarkIcon,
  ExternalIcon,
  OmnivoreIcon,
  type SwipeableCardHandle,
} from "./SwipeableCard";
import { Toast, useToast } from "./Toast";

export function ShortsReader() {
  const { toast, showToast } = useToast();
  const searchParams = useSearchParams();
  const feedParam = searchParams.get("feed");

  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardHandles = useRef<Map<number, SwipeableCardHandle>>(new Map());

  useEffect(() => {
    const query = feedParam ? `?feed=${feedParam}` : "?mix=1";
    fetch(`/api/articles${query}`)
      .then((response) => response.json())
      .then(setArticles)
      .finally(() => setLoading(false));
  }, [feedParam]);

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
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        cardHandles.current.get(current)?.swipe("right");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        cardHandles.current.get(current)?.swipe("left");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [articles.length, current, scrollToIndex]);

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
        {articles.length > 0 && (
          <span className="rounded-full border border-line bg-paper-raised/90 px-3.5 py-2 text-[13px] tabular-nums text-ink-faint backdrop-blur">
            {current + 1} / {articles.length}
          </span>
        )}
      </div>

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
          <p className="font-serif text-xl text-ink">No articles yet</p>
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
