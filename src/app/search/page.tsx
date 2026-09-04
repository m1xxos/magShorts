"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArticleGrid, ArticleGridSkeleton } from "@/components/ArticleGrid";
import { SearchField } from "@/components/SearchField";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { Reader, after } from "@/components/Reader";
import {
  type ArticleDto,
  type Density,
  type FeedDto,
  type FolderDto,
} from "@/lib/types";
import { removeFromReadingList, saveToReadingList } from "@/lib/actions";
import { useReader } from "@/lib/useReader";
import { useUser } from "@/lib/useUser";

const PAGE_SIZE = 40;

// Read from the address bar rather than held in state, because the reader
// pushes ?article= onto whatever is already there: /search?q=foo&article=12
// opens a result over its own list and closes back onto it, and the link
// survives being pasted somewhere else.
function queryFromUrl(): string {
  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

export default function SearchPage() {
  const user = useUser();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArticleDto[]>([]);
  // Which query the results on screen belong to. A slow answer to an old
  // query must not overwrite a fast answer to a new one.
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const loadingMore = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [density, setDensity] = useState<Density>("cards");
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  // Links already saved, so the reader's bookmark starts in the right state.
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { toast, showToast } = useToast();

  useEffect(() => {
    const saved = window.localStorage.getItem("ms_density");
    if (saved === "cards" || saved === "list" || saved === "compact") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
      setDensity(saved);
    }
  }, []);

  // The query lives in the URL, so it has to be re-read when the URL moves —
  // which the top bar does on every search and the reader does on every open.
  useEffect(() => {
    function apply() {
      setQuery(queryFromUrl());
    }
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  const loadReadingList = useCallback(async () => {
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

  async function toggleSave(article: ArticleDto) {
    const result = savedLinks.has(article.link)
      ? await removeFromReadingList(article.link)
      : await saveToReadingList(article);
    showToast(result.message, !result.ok);
    if (result.ok) void loadReadingList();
  }

  useEffect(() => {
    if (!user) return;
    void fetch("/api/feeds")
      .then((response) => response.json())
      .then((data) => setFeeds(Array.isArray(data) ? data : []))
      .catch(() => {});
    void fetch("/api/folders")
      .then((response) => response.json())
      .then((data) => setFolders(Array.isArray(data) ? data : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    void loadReadingList();
  }, [user, loadReadingList]);

  useEffect(() => {
    if (!user) return;
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the box empties, which the URL drives
      setResults([]);
      setLoadedQuery("");
      setHasMore(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}`)
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => [])
      .then((page: ArticleDto[]) => {
        if (cancelled) return;
        setResults(page);
        setHasMore(page.length === PAGE_SIZE);
        setLoadedQuery(query);
      });
    return () => {
      cancelled = true;
    };
  }, [user, query]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore || !query) return;
    loadingMore.current = true;
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${results.length}`
    );
    const page: ArticleDto[] = response.ok ? await response.json() : [];
    setResults((previous) => {
      const seen = new Set(previous.map((article) => article.id));
      return [...previous, ...page.filter((article) => !seen.has(article.id))];
    });
    setHasMore(page.length === PAGE_SIZE);
    loadingMore.current = false;
  }, [hasMore, query, results.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const resolveArticle = useCallback(
    async (id: number): Promise<ArticleDto | null> => {
      const loaded = results.find((article) => article.id === id);
      if (loaded) return loaded;
      const response = await fetch(`/api/articles/${id}`);
      return response.ok ? ((await response.json()) as ArticleDto) : null;
    },
    [results]
  );
  const reader = useReader(resolveArticle);
  // Reading on from a result means the next result, which is a reasonable
  // queue for someone who searched for a subject.
  const upNext = after(
    results,
    results.findIndex((article) => article.id === reader.article?.id)
  );

  const railProps = {
    feeds,
    folders,
    selection: null,
    readingCount,
    onOpenSettings: () => setSettingsOpen(true),
  };
  const loading = !user || loadedQuery !== query;

  return (
    <div className="min-h-screen">
      <TopBar
        username={user?.username}
        searchQuery={query}
        nav={(close) => (
          <Sidebar {...railProps} variant="sheet" onNavigate={close} />
        )}
      />
      <div className="flex">
        <Sidebar {...railProps} />
        <main className="mx-auto min-w-0 max-w-[1180px] flex-1 px-5 py-6 md:px-8">
          {/* The header has no room for a field below sm, so it lives here
              instead — one box visible at a time, never two. */}
          <SearchField
            initial={query}
            autoFocus={!query}
            className="mb-5 sm:hidden"
          />

          <div className="flex items-baseline justify-between gap-4">
            <h1 className="font-serif text-3xl text-ink">
              {query ? `“${query}”` : "Search"}
            </h1>
            <Link
              href="/"
              className="shrink-0 text-sm text-clay hover:underline lg:hidden"
            >
              ← Feed
            </Link>
          </div>
          <p className="mt-1 text-[13px] text-ink-faint">
            {query
              ? loading
                ? "Looking…"
                : `${results.length}${hasMore ? "+" : ""} in your subscriptions`
              : "Titles and tags across everything you subscribe to. Start a search with tag: to look only at tags."}
          </p>

          <div className="mt-6">
            {!query ? null : loading ? (
              <ArticleGridSkeleton density={density} />
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <p className="font-serif text-xl text-ink">Nothing matched</p>
                <p className="max-w-sm text-sm text-ink-faint">
                  Search covers titles and tags, not the text of the articles —
                  so a word from the middle of one will not find it.
                </p>
              </div>
            ) : (
              <>
                <ArticleGrid
                  articles={results}
                  density={density}
                  onOpen={reader.open}
                  onToast={(message, error) => {
                    showToast(message, error);
                    if (!error) void loadReadingList();
                  }}
                />
                <div ref={sentinelRef} className="h-px" />
                {hasMore && (
                  <p className="py-6 text-center text-[13px] text-ink-faint">
                    Loading more…
                  </p>
                )}
              </>
            )}
          </div>
        </main>
      </div>
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(message) => showToast(message)}
        />
      )}
      {reader.article && (
        <Reader
          article={reader.article}
          originLabel="search"
          upNext={upNext}
          saved={savedLinks.has(reader.article.link)}
          onToggleSave={() => toggleSave(reader.article!)}
          onToast={showToast}
          onOpenArticle={reader.open}
          onClose={reader.close}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
