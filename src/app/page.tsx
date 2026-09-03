"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { removeFromReadingList, saveToReadingList } from "@/lib/actions";
import {
  type ArticleDto,
  type Density,
  type FeedDto,
  type FolderDto,
  type RecWindow,
  type Selection,
} from "@/lib/types";
import { Reader, after } from "@/components/Reader";
import { ArticleCard } from "@/components/ArticleCard";
import { SettingsDialog } from "@/components/SettingsDialog";
import { FolderIcon, Sidebar, SparkleIcon } from "@/components/Sidebar";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { useReader } from "@/lib/useReader";
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
  // Two floors, because no single one satisfies both ends: a portrait tablet
  // needs <=238px to fit three columns, while five columns on a 2000px window
  // need >258px.
  cards:
    "grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5 min-[1536px]:grid-cols-[repeat(auto-fill,minmax(270px,1fr))]",
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

// The query the sidebar already builds for these, kept in one place so
// arriving by link and choosing in place cannot disagree.
function homeUrl(selection: Selection): string {
  if (selection.kind === "feed") return `/?feed=${selection.feedId}`;
  if (selection.kind === "folder") return `/?folder=${selection.folderId}`;
  return `/?view=${selection.kind}`;
}

// Two selections that name the same list. Compared by value because the load
// effect keys on the object: handing it an equal-but-new one refetches the
// grid, which empties it, which loses the scroll position the reader was
// closed to get back to.
function sameList(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "feed" && b.kind === "feed") return a.feedId === b.feedId;
  if (a.kind === "folder" && b.kind === "folder") {
    return a.folderId === b.folderId;
  }
  return true;
}

function selectionFromUrl(): Selection | null {
  const params = new URLSearchParams(window.location.search);
  const feedId = Number(params.get("feed"));
  if (Number.isInteger(feedId) && feedId > 0) return { kind: "feed", feedId };
  const folderId = Number(params.get("folder"));
  if (Number.isInteger(folderId) && folderId > 0) {
    return { kind: "folder", folderId };
  }
  if (params.get("view") === "forYou") return { kind: "forYou" };
  if (params.get("view") === "all") return { kind: "all" };
  return null;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Whether a headline opens here or leaves for the publisher. ArticleCard
  // already branches on whether it was given an onOpen, so the setting is
  // applied by withholding the handler rather than by new code in the card.
  const [openInReader, setOpenInReader] = useState(true);
  const [readingCount, setReadingCount] = useState(0);
  // Links already in Read later, so the reader's bookmark pill starts in the
  // right state. Kept by link because that is what Read later itself stores.
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
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
  const settingsRead = useRef(false);
  useEffect(() => {
    if (!user) return;

    // The sidebar on other pages links here with the selection in the URL, so
    // an explicit choice wins over the configured default view. Read from
    // location rather than useSearchParams: this page is prerendered, and that
    // hook would drag in a Suspense boundary for three lines of parsing.
    async function resolveView(): Promise<Selection> {
      const fromUrl = selectionFromUrl();
      if (fromUrl) return fromUrl;

      // Only the first time: the default view answers "what should I see when
      // I arrive with nothing specified", not "what should Back mean".
      if (settingsRead.current) return { kind: "all" };
      settingsRead.current = true;
      const settings: { default_view?: string; open_in_reader?: string } =
        await fetch("/api/settings")
          .then((response) => response.json())
          .catch(() => ({}));
      setOpenInReader(settings.open_in_reader !== "off");
      const view = settings.default_view ?? "";
      if (view === "forYou") return { kind: "forYou" };
      if (view.startsWith("folder:")) {
        const folderId = Number(view.slice("folder:".length));
        return Number.isInteger(folderId)
          ? { kind: "folder", folderId }
          : { kind: "all" };
      }
      return { kind: "all" };
    }

    let latest = true;
    function apply() {
      void resolveView().then((next) => {
        if (!latest) return;
        setSelection((previous) => (sameList(previous, next) ? previous : next));
      });
    }
    apply();
    // Back and Forward have to re-read the list out of the entry they landed
    // on. Without this the URL says one thing and the grid shows another.
    window.addEventListener("popstate", apply);
    return () => {
      latest = false;
      window.removeEventListener("popstate", apply);
    };
  }, [user]);

  // Every change of list goes through here, so the address bar always names
  // what is on screen. It is a history entry because the same click already
  // was one from every other page — the rail pushes /?feed=N — and one control
  // that means two different things depending on where you stand is exactly
  // what made moving around here feel arbitrary.
  const chooseList = useCallback((next: Selection) => {
    setSelection(next);
    window.history.pushState(null, "", homeUrl(next));
  }, []);

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




  // The reader's article may not be on a page the grid has loaded — a pasted
  // ?article= link, or the tail of a long list — so fall back to fetching it.
  const resolveArticle = useCallback(
    async (id: number): Promise<ArticleDto | null> => {
      const loaded = articles.find((article) => article.id === id);
      if (loaded) return loaded;
      const response = await fetch(`/api/articles/${id}`);
      return response.ok ? ((await response.json()) as ArticleDto) : null;
    },
    [articles]
  );
  const reader = useReader(resolveArticle);

  // What follows this article in the list it was opened from, so finishing one
  // continues the queue instead of ending the session.
  const upNext = after(
    articles,
    articles.findIndex((a) => a.id === reader.article?.id)
  );

  async function toggleSave(article: ArticleDto) {
    const wasSaved = savedLinks.has(article.link);
    const result = wasSaved
      ? await removeFromReadingList(article.link)
      : await saveToReadingList(article);
    showToast(result.message, !result.ok);
    if (result.ok) loadReadingCount();
  }

  const railProps = {
    feeds,
    folders,
    selection,
    readingCount,
    onSelect: chooseList,
    onOpenSettings: () => setSettingsOpen(true),
  };

  return (
    <div className="min-h-screen">
      <TopBar
        selectedFeedId={selectedFeedId}
        username={user?.username}
        nav={<Sidebar {...railProps} variant="sheet" />}
      />
      {/* Full-bleed: the grid runs to the window edges, flush with the top bar. */}
      <div className="flex">
        <Sidebar {...railProps} />
        <main className="min-w-0 flex-1 px-5 py-6 md:px-8">
          {/* Mobile feed chips */}
          <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 lg:hidden">
            <button
              onClick={() => chooseList({ kind: "forYou" })}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] ${
                selection?.kind === "forYou"
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              <SparkleIcon size={11} /> For you
            </button>
            <button
              onClick={() => chooseList({ kind: "all" })}
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
                  onClick={() => chooseList({ kind: "feed", feedId: feed.id })}
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
                  chooseList({ kind: "folder", folderId: folder.id })
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
            {/* Below lg there is no rail, so this is the only way to reach
                subscriptions from the grid. It goes where adding now lives. */}
            <Link
              href="/sources"
              className="shrink-0 rounded-full border border-dashed border-line px-3.5 py-1.5 text-[13px] text-clay"
            >
              + Add
            </Link>
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
                Subscribe to a publication and fresh articles will appear here.
              </p>
              <Link
                href="/sources"
                className="rounded-full bg-clay px-4 py-2 text-sm text-white transition hover:brightness-95"
              >
                Add a publication
              </Link>
            </div>
          ) : (
            <>
              <div className={GRID_CLASSES[density]}>
                {articles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    density={density}
                    onOpen={openInReader ? reader.open : undefined}
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

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(message) => showToast(message)}
        />
      )}
      {reader.article && (
        <Reader
          article={reader.article}
          originLabel={sectionTitle}
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
