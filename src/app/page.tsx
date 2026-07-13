"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ArticleDto,
  type FeedDto,
  type RecWindow,
  type Selection,
} from "@/lib/types";
import { AddFeedDialog } from "@/components/AddFeedDialog";
import { ArticleCard } from "@/components/ArticleCard";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar, SparkleIcon } from "@/components/Sidebar";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { useUser } from "@/lib/useUser";

const REC_WINDOWS: Array<{ value: RecWindow; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const PAGE_SIZE = 40;

export default function HomePage() {
  const user = useUser();
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  const [recWindow, setRecWindow] = useState<RecWindow>("week");
  const [coldStart, setColdStart] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readingCount, setReadingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const loadingMore = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { toast, showToast } = useToast();
  const selectedFeedId = selection.kind === "feed" ? selection.feedId : null;

  useEffect(() => {
    const saved = window.localStorage.getItem("ms_rec_window");
    if (saved === "day" || saved === "week" || saved === "month") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
      setRecWindow(saved);
    }
  }, []);

  function changeRecWindow(value: RecWindow) {
    setRecWindow(value);
    window.localStorage.setItem("ms_rec_window", value);
  }

  const loadFeeds = useCallback(async () => {
    const response = await fetch("/api/feeds");
    setFeeds(await response.json());
  }, []);

  const loadReadingCount = useCallback(async () => {
    const response = await fetch("/api/reading-list");
    const items = await response.json();
    setReadingCount(Array.isArray(items) ? items.length : 0);
  }, []);

  const fetchPage = useCallback(
    async (
      target: Selection,
      window: RecWindow,
      offset: number
    ): Promise<ArticleDto[]> => {
      if (target.kind === "forYou") {
        const response = await fetch(
          `/api/recommendations?window=${window}&limit=${PAGE_SIZE}&offset=${offset}`
        );
        const data = await response.json();
        if (offset === 0) setColdStart(Boolean(data.coldStart));
        return data.articles ?? [];
      }
      const query =
        target.kind === "feed" ? `feed=${target.feedId}` : "mix=1";
      const response = await fetch(
        `/api/articles?${query}&limit=${PAGE_SIZE}&offset=${offset}`
      );
      if (offset === 0) setColdStart(false);
      return response.json();
    },
    []
  );

  const loadArticles = useCallback(
    async (target: Selection, window: RecWindow) => {
      setLoading(true);
      try {
        const page = await fetchPage(target, window, 0);
        setArticles(page);
        setHasMore(page.length === PAGE_SIZE);
      } finally {
        setLoading(false);
      }
    },
    [fetchPage]
  );

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore || loading) return;
    loadingMore.current = true;
    try {
      const page = await fetchPage(selection, recWindow, articles.length);
      setArticles((previous) => {
        const seen = new Set(previous.map((article) => article.id));
        return [...previous, ...page.filter((article) => !seen.has(article.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      loadingMore.current = false;
    }
  }, [selection, recWindow, articles.length, hasMore, loading, fetchPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    loadFeeds();
    loadReadingCount();
  }, [user, loadFeeds, loadReadingCount]);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    loadArticles(selection, recWindow);
  }, [user, selection, recWindow, loadArticles]);

  async function removeFeed(feed: FeedDto) {
    if (!confirm(`Unsubscribe from “${feed.title}”?`)) return;
    await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    if (selectedFeedId === feed.id) setSelection({ kind: "all" });
    else loadArticles(selection, recWindow);
    loadFeeds();
  }

  async function toggleFeed(feed: FeedDto) {
    await fetch(`/api/feeds/${feed.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !feed.enabled }),
    });
    showToast(
      feed.enabled ? `${feed.title} turned off` : `${feed.title} turned on`
    );
    loadFeeds();
    loadArticles(selection, recWindow);
  }

  return (
    <div className="min-h-screen">
      <TopBar selectedFeedId={selectedFeedId} username={user?.username} />
      <div className="mx-auto flex max-w-[1500px]">
        <Sidebar
          feeds={feeds}
          selection={selection}
          readingCount={readingCount}
          onSelect={setSelection}
          onRemove={removeFeed}
          onToggle={toggleFeed}
          onAddClick={() => setDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="min-w-0 flex-1 px-5 py-6 md:px-8">
          {/* Mobile feed chips */}
          <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 md:hidden">
            <button
              onClick={() => setSelection({ kind: "forYou" })}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] ${
                selection.kind === "forYou"
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              <SparkleIcon size={11} /> For you
            </button>
            <button
              onClick={() => setSelection({ kind: "all" })}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] ${
                selection.kind === "all"
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              All
            </button>
            {feeds.map((feed) => (
              <button
                key={feed.id}
                onClick={() => setSelection({ kind: "feed", feedId: feed.id })}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] ${
                  selectedFeedId === feed.id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper-raised text-ink-soft"
                }`}
              >
                {feed.title}
              </button>
            ))}
            <button
              onClick={() => setDialogOpen(true)}
              className="shrink-0 rounded-full border border-dashed border-line px-3.5 py-1.5 text-[13px] text-clay"
            >
              + Add
            </button>
            <Link
              href="/reading-list"
              className="shrink-0 rounded-full border border-line bg-paper-raised px-3.5 py-1.5 text-[13px] text-ink-soft"
            >
              Read later{readingCount > 0 ? ` (${readingCount})` : ""}
            </Link>
          </div>

          {selection.kind === "forYou" && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <h2 className="flex items-center gap-2 font-serif text-lg text-ink">
                <span className="text-clay">
                  <SparkleIcon size={15} />
                </span>
                For you
              </h2>
              <div className="flex rounded-full border border-line p-0.5">
                {REC_WINDOWS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => changeRecWindow(option.value)}
                    className={`rounded-full px-3 py-1 text-[12px] transition ${
                      recWindow === option.value
                        ? "bg-clay text-white"
                        : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {coldStart && !loading && (
                <p className="w-full rounded-xl border border-dashed border-line bg-paper-raised px-4 py-2.5 text-[13px] text-ink-soft">
                  Still learning your taste — save, like or open a few articles
                  and this feed will tune itself. Showing the freshest mix for
                  now.
                </p>
              )}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse overflow-hidden rounded-2xl border border-line bg-paper-raised"
                >
                  <div className="aspect-video bg-paper-sunken" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-11/12 rounded bg-paper-sunken" />
                    <div className="h-4 w-2/3 rounded bg-paper-sunken" />
                    <div className="h-3 w-1/3 rounded bg-paper-sunken" />
                  </div>
                </div>
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="font-serif text-xl text-ink">Nothing here yet</p>
              <p className="max-w-sm text-sm text-ink-faint">
                Add a publication with the button in the sidebar and fresh
                articles will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {articles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onToast={(message, error) => {
                      showToast(message, error);
                      if (!error) loadReadingCount();
                    }}
                  />
                ))}
              </div>
              <div ref={sentinelRef} className="h-px" />
              {hasMore && (
                <p className="py-6 text-center text-[13px] text-ink-faint">
                  Loading more…
                </p>
              )}
            </>
          )}
        </main>
      </div>

      {dialogOpen && (
        <AddFeedDialog
          onClose={() => setDialogOpen(false)}
          onAdded={() => {
            loadFeeds();
            loadArticles(selection, recWindow);
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(message) => showToast(message)}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
