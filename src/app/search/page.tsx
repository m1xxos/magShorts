"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArticleGrid, ArticleGridSkeleton } from "@/components/ArticleGrid";
import { SearchField, searchUrl } from "@/components/SearchField";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { Toast, useToast } from "@/components/Toast";
import { Chip, ChipRow } from "@/components/ui/ChipRow";
import { Segmented } from "@/components/ui/Segmented";
import { TopBar } from "@/components/TopBar";
import { Reader, after } from "@/components/Reader";
import {
  type ArticleDto,
  type Density,
  type FeedDto,
  type FolderDto,
  type SearchSort,
  type SearchSourceDto,
} from "@/lib/types";
import { removeFromReadingList, saveToReadingList } from "@/lib/actions";
import { useReader } from "@/lib/useReader";
import { useUser } from "@/lib/useUser";

const PAGE_SIZE = 40;

const SORTS: Array<{ value: SearchSort; label: string; title: string }> = [
  { value: "relevance", label: "Relevance", title: "Best match first" },
  { value: "newest", label: "Newest", title: "Most recently published first" },
  { value: "oldest", label: "Oldest", title: "Earliest published first" },
];

// A broad word lands in three dozen publications here, and three dozen chips
// is not a filter, it is a wall. The rest are one press away.
const SOURCE_LIMIT = 8;

function isSort(value: string | null): value is SearchSort {
  return value === "relevance" || value === "newest" || value === "oldest";
}

export default function SearchPage() {
  // useSearchParams needs one, and the page is otherwise prerendered.
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}

function SearchResults() {
  const user = useUser();
  // From the address bar, not from state, because the reader appends
  // ?article= to whatever is already there: /search?q=foo&article=12 opens a
  // result over its own list and closes back onto it, and the link survives
  // being pasted somewhere else.
  //
  // useSearchParams rather than reading location on popstate: searching again
  // from this page is a router.push to the same route, which fires no popstate
  // and does not remount anything — so the URL changed and the results did
  // not. This hook hears both.
  const params = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const sortParam = params.get("sort");
  const sort: SearchSort = isSort(sortParam) ? sortParam : "relevance";
  const feedParam = Number(params.get("feed"));
  const feed = Number.isInteger(feedParam) && feedParam > 0 ? feedParam : null;
  const requestKey = `${query}\u0000${sort}\u0000${feed ?? ""}`;
  const [results, setResults] = useState<ArticleDto[]>([]);
  // Which request the results on screen belong to — the query, the order and
  // the publication together, because changing any of the three changes the
  // list. A slow answer to an old one must not overwrite a fast answer to a
  // new one, and the skeleton has to appear when the order changes rather
  // than leaving the previous order on screen looking like the new one.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const loadingMore = useRef(false);
  // Aborted when the query changes, so a page-two request started for one
  // search cannot deliver into another one's results.
  const pageRequest = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [density, setDensity] = useState<Density>("cards");
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  // Links already saved, so the reader's bookmark starts in the right state.
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tags, setTags] = useState<Array<{ topic: string; count: number }>>([]);
  // Which publications this query found anything in. Fetched per query, not
  // per sort or per publication: reordering the same results cannot change
  // which publications they came from, and neither can narrowing to one.
  const [sources, setSources] = useState<SearchSourceDto[]>([]);
  const [loadedSourcesQuery, setLoadedSourcesQuery] = useState("");
  const [allSources, setAllSources] = useState(false);
  const { toast, showToast } = useToast();


  useEffect(() => {
    const saved = window.localStorage.getItem("ms_density");
    if (saved === "cards" || saved === "list" || saved === "compact") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
      setDensity(saved);
    }
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
    void fetch("/api/tags")
      .then((response) => response.json())
      .then((data) => setTags(Array.isArray(data) ? data : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    void loadReadingList();
  }, [user, loadReadingList]);

  // One controller per request, so every page asked for on its behalf can be
  // called off together when the query, the order or the publication changes.
  useEffect(() => {
    const controller = new AbortController();
    pageRequest.current = controller;
    return () => controller.abort();
  }, [requestKey]);

  useEffect(() => {
    if (!user) return;
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the box empties, which the URL drives
      setResults([]);
      setLoadedKey(requestKey);
      setHasMore(false);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/search?q=${encodeURIComponent(query)}&sort=${sort}` +
        (feed ? `&feed=${feed}` : "") +
        `&limit=${PAGE_SIZE}`
    )
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => [])
      .then((page: ArticleDto[]) => {
        if (cancelled) return;
        setResults(page);
        setHasMore(page.length === PAGE_SIZE);
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [user, query, sort, feed, requestKey]);

  useEffect(() => {
    if (!user || !query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the filter when the box empties, which the URL drives
      setSources([]);
      setLoadedSourcesQuery(query);
      return;
    }
    let cancelled = false;
    void fetch(`/api/search/sources?q=${encodeURIComponent(query)}`)
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => [])
      .then((rows: SearchSourceDto[]) => {
        if (cancelled) return;
        setSources(Array.isArray(rows) ? rows : []);
        setLoadedSourcesQuery(query);
        // A new search is a new set of publications, and an expanded row of
        // the last one's is not a head start.
        setAllSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, query]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore || !query) return;
    loadingMore.current = true;
    let page: ArticleDto[] = [];
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&sort=${sort}` +
          (feed ? `&feed=${feed}` : "") +
          `&limit=${PAGE_SIZE}&offset=${results.length}`,
        { signal: pageRequest.current?.signal }
      );
      page = response.ok ? await response.json() : [];
    } catch {
      // Aborted because the query moved on. Appending this would put one
      // search's results under another search's heading.
      loadingMore.current = false;
      return;
    }
    setResults((previous) => {
      const seen = new Set(previous.map((article) => article.id));
      return [...previous, ...page.filter((article) => !seen.has(article.id))];
    });
    setHasMore(page.length === PAGE_SIZE);
    loadingMore.current = false;
  }, [hasMore, query, sort, feed, results.length]);

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

  // Which tag, if any, this search is. Read off the query rather than kept
  // beside it, so a pasted /search?q=tag:python link lights the same chip.
  const activeTag = /^\s*(?:tag|тег):\s*(.+)$/i.exec(query)?.[1]?.trim() ?? "";

  // pushState rather than router.push throughout: this is the route we are
  // already on, and a production build does not re-render for a push to the
  // same one.
  const go = useCallback((url: string) => {
    window.history.pushState(null, "", url);
  }, []);

  const searchTag = useCallback(
    (topic: string) => {
      const next =
        activeTag.toLowerCase() === topic.toLowerCase() ? "" : `tag:${topic}`;
      // The order survives a change of query — it is how this reader likes to
      // look at results. The publication does not: it was picked out of one
      // search's own sources and means nothing in the next.
      go(searchUrl(next, sort, null));
    },
    [activeTag, go, sort]
  );

  // The publication currently narrowed to, taken from the sources rather than
  // kept beside them, so a pasted ?feed= link lights the right chip.
  const activeSource = sources.find((row) => row.feed_id === feed) ?? null;
  const total = sources.reduce((sum, row) => sum + row.count, 0);
  // The busiest handful, plus the one being filtered on wherever it ranks —
  // a chip you are pressing has to be visible to be pressed again.
  const shownSources =
    allSources || sources.length <= SOURCE_LIMIT + 1
      ? sources
      : [
          ...sources.slice(0, SOURCE_LIMIT),
          ...(activeSource && sources.indexOf(activeSource) >= SOURCE_LIMIT
            ? [activeSource]
            : []),
        ];
  // The real number, now that the sources have counted them. Until they land —
  // and on the page that failed to fetch them — the length of what is on
  // screen, which is the honest answer to how many there are.
  const counted =
    loadedSourcesQuery === query && sources.length > 0
      ? activeSource
        ? `${activeSource.count} from ${activeSource.feed_title}`
        : `${total} in your subscriptions`
      : `${results.length}${hasMore ? "+" : ""} in your subscriptions`;

  const railProps = {
    feeds,
    folders,
    selection: null,
    readingCount,
    onOpenSettings: () => setSettingsOpen(true),
  };
  const loading = !user || loadedKey !== requestKey;

  return (
    <div className="min-h-screen">
      <TopBar
        username={user?.username}
        searchQuery={query}
        searchSort={sort}
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
            sort={sort}
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
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <p className="text-[13px] text-ink-faint">
              {query
                ? loading
                  ? "Looking…"
                  : counted
                : "Titles and tags across everything you subscribe to. Pick a tag below, or type."}
            </p>
            {/* Only where there is something to order. On an empty page it
                would be three buttons that do nothing, and on a search that
                found one article it is a distinction without a difference. */}
            {query && results.length > 1 && (
              <Segmented
                options={SORTS}
                value={sort}
                onChange={(next) => go(searchUrl(query, next, feed))}
                ariaLabel="How to order the results"
              />
            )}
          </div>

          {/* The tags you actually have, so searching by one is a tap rather
              than knowing that "tag:" is a thing you can type.
              Not shown over the results of a typed search: a tag chip
              *replaces* the query rather than narrowing it, so there it is a
              row of buttons that throw away what you came here with. On the
              empty page it is the way in, and on a tag search it is how you
              switch tag or turn the tag off. */}
          {tags.length > 0 && (!query || activeTag) && (
            <ChipRow wrap className="mt-4">
              {tags.map((tag) => (
                <Chip
                  key={tag.topic}
                  active={activeTag.toLowerCase() === tag.topic.toLowerCase()}
                  count={tag.count}
                  onClick={() => searchTag(tag.topic)}
                >
                  {tag.topic}
                </Chip>
              ))}
            </ChipRow>
          )}

          {/* Which publications these results came from. A refinement of the
              search you already have, unlike the tags above, and the reason
              it sits closest to the results. One publication is not a choice
              between anything.
              Not wrapped, unlike the tags: this row sits directly above the
              results, and at 420px a wrapped row of nine publications took
              five lines and pushed the first card off the screen. A row that
              scrolls sideways costs one line at any width. */}
          {query && sources.length > 1 && loadedSourcesQuery === query && (
            <ChipRow className="mt-4">
              <Chip active={!feed} onClick={() => go(searchUrl(query, sort, null))}>
                All sources
              </Chip>
              {shownSources.map((source) => (
                <Chip
                  key={source.feed_id}
                  active={feed === source.feed_id}
                  count={source.count}
                  onClick={() =>
                    go(
                      searchUrl(
                        query,
                        sort,
                        feed === source.feed_id ? null : source.feed_id
                      )
                    )
                  }
                >
                  {source.feed_title}
                </Chip>
              ))}
              {shownSources.length < sources.length && (
                <Chip active={false} onClick={() => setAllSources(true)}>
                  {sources.length - shownSources.length} more
                </Chip>
              )}
            </ChipRow>
          )}

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
