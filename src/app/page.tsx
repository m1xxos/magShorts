"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ArticleDto,
  type Density,
  type FeedDto,
  type FolderDto,
  type RecWindow,
  type Selection,
} from "@/lib/types";
import { AddFeedDialog } from "@/components/AddFeedDialog";
import { CreateFolderDialog } from "@/components/CreateFolderDialog";
import { ArticleCard } from "@/components/ArticleCard";
import { SettingsDialog } from "@/components/SettingsDialog";
import { FolderIcon, Sidebar, SparkleIcon } from "@/components/Sidebar";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { useUser } from "@/lib/useUser";

const REC_WINDOWS: Array<{ value: RecWindow; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const DENSITIES: Array<{ value: Density; label: string }> = [
  { value: "cards", label: "Cards" },
  { value: "list", label: "List" },
  { value: "compact", label: "Compact" },
];

// Cards keep the responsive 1/2/3/4 layout; the denser modes are single-column
// rows. Shared by the skeleton and the real grid so the two cannot drift.
// auto-fill rather than fixed breakpoints: the row takes as many columns as
// fit at the minimum width, so the count follows the window on any display
// instead of stepping at sizes picked in advance. The minimum is the only
// knob — raise it for fewer, wider cards.
const GRID_CLASSES: Record<Density, string> = {
  cards: "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5",
  // The dense modes get their own, much wider minimum so a row never stretches
  // to a full window's worth of unreadably long summary lines.
  list: "grid grid-cols-[repeat(auto-fill,minmax(520px,1fr))] gap-3",
  compact: "grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-1.5",
};

const PAGE_SIZE = 40;

function Skeleton({ density }: { density: Density }) {
  if (density === "compact") {
    return (
      <div className="flex min-h-14 animate-pulse items-center gap-3 rounded-xl border border-line bg-paper-raised px-4">
        <div className="h-6 w-6 shrink-0 rounded-full bg-paper-sunken" />
        <div className="h-4 w-2/3 rounded bg-paper-sunken" />
      </div>
    );
  }
  if (density === "list") {
    return (
      <div className="flex animate-pulse gap-4 rounded-2xl border border-line bg-paper-raised p-3">
        <div className="aspect-[4/3] w-[104px] shrink-0 rounded-[10px] bg-paper-sunken sm:w-[140px]" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3 w-1/4 rounded bg-paper-sunken" />
          <div className="h-4 w-10/12 rounded bg-paper-sunken" />
          <div className="h-3 w-full rounded bg-paper-sunken" />
        </div>
      </div>
    );
  }
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-line bg-paper-raised">
      <div className="aspect-[2/1] bg-paper-sunken" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-11/12 rounded bg-paper-sunken" />
        <div className="h-4 w-2/3 rounded bg-paper-sunken" />
        <div className="h-3 w-1/3 rounded bg-paper-sunken" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const user = useUser();
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [articles, setArticles] = useState<ArticleDto[]>([]);
  // Resolved from the default_view setting on first load; null until then.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [recWindow, setRecWindow] = useState<RecWindow>("week");
  const [density, setDensity] = useState<Density>("cards");
  const [coldStart, setColdStart] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readingCount, setReadingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const loadingMore = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { toast, showToast } = useToast();
  const selectedFeedId =
    selection?.kind === "feed" ? selection.feedId : null;
  // Names the grid below; "All publications" also covers the brief null
  // window before the default view resolves.
  const sectionTitle =
    selection?.kind === "forYou"
      ? "For you"
      : selection?.kind === "folder"
        ? (folders.find((folder) => folder.id === selection.folderId)?.name ??
          "Folder")
        : selection?.kind === "feed"
          ? (feeds.find((feed) => feed.id === selection.feedId)?.title ??
            "Publication")
          : "All publications";

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

  useEffect(() => {
    const saved = window.localStorage.getItem("ms_density");
    if (saved === "cards" || saved === "list" || saved === "compact") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
      setDensity(saved);
    }
  }, []);

  function changeDensity(value: Density) {
    setDensity(value);
    window.localStorage.setItem("ms_density", value);
  }

  const loadFeeds = useCallback(async () => {
    const [feedsResponse, foldersResponse] = await Promise.all([
      fetch("/api/feeds"),
      fetch("/api/folders"),
    ]);
    setFeeds(await feedsResponse.json());
    const folderList: FolderDto[] = await foldersResponse.json();
    setFolders(folderList);
    // A stored default view may point at a folder that no longer exists.
    setSelection((previous) =>
      previous &&
      previous.kind === "folder" &&
      !folderList.some((folder) => folder.id === previous.folderId)
        ? { kind: "all" }
        : previous
    );
  }, []);

  // Open the view chosen in Settings (All publications / For you / a folder).
  const viewInitialized = useRef(false);
  useEffect(() => {
    if (!user || viewInitialized.current) return;
    viewInitialized.current = true;
    fetch("/api/settings")
      .then((response) => response.json())
      .then((settings: { default_view?: string }) => {
        const view = settings.default_view ?? "";
        if (view === "forYou") {
          setSelection({ kind: "forYou" });
        } else if (view.startsWith("folder:")) {
          const folderId = Number(view.slice("folder:".length));
          setSelection(
            Number.isInteger(folderId)
              ? { kind: "folder", folderId }
              : { kind: "all" }
          );
        } else {
          setSelection({ kind: "all" });
        }
      })
      .catch(() => setSelection({ kind: "all" }));
  }, [user]);

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
      // A folder groups a handful of slow publications, so plain reverse
      // chronology reads right; only All publications needs the per-feed
      // round-robin that keeps a prolific feed from flooding the grid.
      const query =
        target.kind === "feed"
          ? `feed=${target.feedId}`
          : target.kind === "folder"
            ? `folder=${target.folderId}`
            : "mix=1";
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
    if (!selection || loadingMore.current || !hasMore || loading) return;
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
    if (!user || !selection) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    loadArticles(selection, recWindow);
  }, [user, selection, recWindow, loadArticles]);

  async function removeFeed(feed: FeedDto) {
    if (!confirm(`Unsubscribe from “${feed.title}”?`)) return;
    await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    if (selectedFeedId === feed.id) setSelection({ kind: "all" });
    else if (selection) loadArticles(selection, recWindow);
    loadFeeds();
  }

  async function toggleFolder(folder: FolderDto) {
    await fetch(`/api/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_in_main: !folder.include_in_main }),
    });
    showToast(
      folder.include_in_main
        ? `${folder.name} won’t feed For you`
        : `${folder.name} now feeds For you`
    );
    loadFeeds();
    if (selection) loadArticles(selection, recWindow);
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
    if (selection) loadArticles(selection, recWindow);
  }

  return (
    <div className="min-h-screen">
      <TopBar selectedFeedId={selectedFeedId} username={user?.username} />
      {/* Full-bleed: the grid runs to the window edges, flush with the top bar. */}
      <div className="flex">
        <Sidebar
          feeds={feeds}
          folders={folders}
          selection={selection}
          readingCount={readingCount}
          onSelect={setSelection}
          onRemove={removeFeed}
          onToggle={toggleFeed}
          onToggleFolder={toggleFolder}
          onAddClick={() => setDialogOpen(true)}
          onNewFolder={() => setFolderDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="min-w-0 flex-1 px-5 py-6 md:px-8">
          {/* Mobile feed chips */}
          <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 md:hidden">
            <button
              onClick={() => setSelection({ kind: "forYou" })}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] ${
                selection?.kind === "forYou"
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              <SparkleIcon size={11} /> For you
            </button>
            <button
              onClick={() => setSelection({ kind: "all" })}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] ${
                selection?.kind === "all"
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              All
            </button>
            {feeds
              .filter((feed) => feed.folder_id === null)
              .map((feed) => (
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
            {folders.map((folder) => (
              <button
                key={`folder-${folder.id}`}
                onClick={() =>
                  setSelection({ kind: "folder", folderId: folder.id })
                }
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] ${
                  selection?.kind === "folder" && selection.folderId === folder.id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper-raised text-ink-soft"
                }`}
              >
                <FolderIcon size={11} /> {folder.name}
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

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 font-serif text-[19px] text-ink">
              {selection?.kind === "forYou" && (
                <span className="text-clay">
                  <SparkleIcon size={15} />
                </span>
              )}
              {sectionTitle}
            </h2>
            {selection?.kind === "forYou" && (
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
            )}
            <div className="ml-auto flex rounded-full border border-line p-0.5">
              {DENSITIES.map((option) => (
                <button
                  key={option.value}
                  onClick={() => changeDensity(option.value)}
                  aria-pressed={density === option.value}
                  className={`rounded-full px-3 py-1 text-[12px] transition ${
                    density === option.value
                      ? "bg-ink text-paper"
                      : "text-ink-faint hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {selection?.kind === "forYou" && coldStart && !loading && (
              <p className="w-full rounded-xl border border-dashed border-line bg-paper-raised px-4 py-2.5 text-[13px] text-ink-soft">
                Still learning your taste — save or open a few articles and
                this feed will tune itself. Showing the freshest mix for now.
              </p>
            )}
          </div>

          {loading ? (
            <div className={GRID_CLASSES[density]}>
              {Array.from({ length: density === "compact" ? 12 : 8 }).map(
                (_, index) => (
                  <Skeleton key={index} density={density} />
                )
              )}
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
              <div className={GRID_CLASSES[density]}>
                {articles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    density={density}
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
            if (selection) loadArticles(selection, recWindow);
          }}
        />
      )}
      {folderDialogOpen && (
        <CreateFolderDialog
          onClose={() => setFolderDialogOpen(false)}
          onCreated={() => loadFeeds()}
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
