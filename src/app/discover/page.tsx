"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  feedTone,
  timeAgo,
  type CatalogArticleDto,
  type CatalogPublicationDto,
  type DiscoverView,
  type FeedDto,
  type FolderDto,
} from "@/lib/types";
import {
  cachedImageUrl,
  recordEvent,
  removeFromReadingList,
  saveToReadingList,
} from "@/lib/actions";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";
import { BookmarkIcon } from "@/components/SwipeableCard";
import { Toast, useToast } from "@/components/Toast";
import { PublicationBlock } from "@/components/PublicationBlock";
import { useUser } from "@/lib/useUser";

const VIEW_KEY = "ms_discover_view";
const PAGE_SIZE = 12;

const VIEWS: Array<{ value: DiscoverView; label: string }> = [
  { value: "publications", label: "Publications" },
  { value: "articles", label: "Articles" },
];

interface Topic {
  topic: string;
  count: number;
}

function looksLikeUrl(value: string): boolean {
  const text = value.trim();
  if (/\s/.test(text)) return false;
  return (
    /^https?:\/\/\S+$/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)
  );
}

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ArticleCard({
  article,
  onFollow,
  onSave,
  onDismiss,
  saved,
}: {
  article: CatalogArticleDto;
  onFollow: (article: CatalogArticleDto) => void;
  onSave: (article: CatalogArticleDto) => void;
  onDismiss: (article: CatalogArticleDto) => void;
  saved: boolean;
}) {
  const tone = feedTone(article.feed_id);
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised">
      <a
        // Straight to the publisher — see PublicationBlock for why.
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => recordEvent(article.link, "open", article.title)}
        className="group flex flex-1 flex-col"
      >
        {article.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cachedImageUrl(article.image_url)}
            alt=""
            loading="lazy"
            className="aspect-[2/1] w-full object-cover"
          />
        ) : (
          <div
            className="aspect-[2/1] w-full"
            style={{
              background: `linear-gradient(135deg, ${tone}18, ${tone}42)`,
            }}
          />
        )}
        <div className="flex flex-1 flex-col gap-[9px] p-4">
          <h3 className="font-serif text-[17px] leading-[1.32] font-medium text-ink group-hover:text-clay">
            {article.title}
          </h3>
          {article.summary && (
            <p className="line-clamp-2 text-[13px] leading-[1.5] text-ink-soft">
              {article.summary}
            </p>
          )}
          <p className="mt-auto flex flex-wrap items-center gap-2">
            {article.topic && (
              <span className="rounded-full bg-paper-sunken px-[9px] py-[3px] text-[11px] text-ink-soft">
                {article.topic}
              </span>
            )}
            <span className="text-[12px] text-ink-faint">
              {timeAgo(article.published_at)}
            </span>
          </p>
        </div>
      </a>
      <div className="mt-auto flex items-center gap-2 border-t border-paper-sunken px-4 py-3">
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-serif text-[11px] text-white"
          style={{ backgroundColor: tone }}
        >
          {article.feed_title.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
          {article.feed_title}
        </span>
        <button
          onClick={() => onSave(article)}
          title={saved ? "Remove from Read later" : "Save to Read later"}
          aria-pressed={saved}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${
            saved
              ? "text-ink"
              : "text-ink-faint hover:bg-paper-sunken hover:text-clay"
          }`}
        >
          <BookmarkIcon size={13} filled={saved} />
        </button>
        {article.is_subscribed ? (
          <span className="shrink-0 text-[12px] text-ink-faint">Following</span>
        ) : (
          <>
            <button
              onClick={() => onFollow(article)}
              className="shrink-0 rounded-full border border-clay px-[11px] py-1 text-[12px] font-medium text-clay transition hover:bg-clay hover:text-white"
            >
              + Follow
            </button>
            {/* Dismisses the publication, not the article — the same answer
                the publications view offers, since a bad suggestion is just as
                visible from here. */}
            <button
              onClick={() => onDismiss(article)}
              title={`Not for me — remove ${article.feed_title} from Discover`}
              aria-label={`Remove ${article.feed_title} from Discover`}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-paper-sunken hover:text-ink"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const user = useUser();
  const [view, setView] = useState<DiscoverView>("publications");
  const [topic, setTopic] = useState<string>("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [publications, setPublications] = useState<CatalogPublicationDto[]>([]);
  const [articles, setArticles] = useState<CatalogArticleDto[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [catalogSize, setCatalogSize] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  // Which request the visible data belongs to. Derived loading beats a
  // setLoading(true) inside the effect, which React flags as a cascading
  // render.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Bumped to re-run the load when an optimistic change has to be taken back.
  const [reloadToken, setReloadToken] = useState(0);
  // The sidebar is navigation here, so it only needs what it displays.
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  // What is already in Read later, by link. Loaded once so the mark survives a
  // reload rather than only lasting as long as the click that made it.
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const { toast, showToast } = useToast();

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/feeds").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/folders").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/reading-list").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([f, fo, rl]) => {
        if (Array.isArray(f)) setFeeds(f);
        if (Array.isArray(fo)) setFolders(fo);
        if (Array.isArray(rl)) {
          setReadingCount(rl.length);
          setSavedLinks(
            new Set((rl as Array<{ link: string }>).map((item) => item.link)),
          );
        }
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === "publications" || stored === "articles") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
      setView(stored);
    }
  }, []);

  // Debounce so a query isn't sent per keystroke; a URL is never a query at
  // all, it's an invitation to subscribe.
  useEffect(() => {
    const id = setTimeout(
      () => setQuery(looksLikeUrl(search) ? "" : search.trim()),
      300,
    );
    return () => clearTimeout(id);
  }, [search]);

  const requestKey = `${view}|${topic}|${query}|${reloadToken}`;
  const loading = !user || loadedKey !== requestKey;

  // Appending the next page. Guarded by a ref rather than state: the observer
  // fires repeatedly while the sentinel is on screen, and a state flag would
  // not have updated yet by the second call.
  const loadingMore = useRef(false);
  const loadMore = useCallback(async () => {
    if (!user || loading || loadingMore.current) return;
    const offset =
      view === "publications" ? publications.length : articles.length;
    if (offset === 0 || offset >= total) return;
    loadingMore.current = true;
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (topic) params.set("topic", topic);
      if (query) params.set("q", query);
      const response = await fetch(`/api/discover/${view}?${params}`);
      if (!response.ok) return;
      const data = await response.json();
      // The catalog is re-ranked per request, so a publication can shift
      // across the page boundary; drop anything already on screen instead of
      // rendering it twice.
      if (view === "publications") {
        setPublications((prev) => {
          const seen = new Set(prev.map((entry) => entry.id));
          return [
            ...prev,
            ...(data.publications ?? []).filter(
              (entry: CatalogPublicationDto) => !seen.has(entry.id),
            ),
          ];
        });
      } else {
        setArticles((prev) => {
          const seen = new Set(prev.map((entry) => entry.id));
          return [
            ...prev,
            ...(data.articles ?? []).filter(
              (entry: CatalogArticleDto) => !seen.has(entry.id),
            ),
          ];
        });
      }
    } finally {
      loadingMore.current = false;
    }
  }, [
    user,
    loading,
    view,
    topic,
    query,
    total,
    publications.length,
    articles.length,
  ]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: "0",
    });
    if (topic) params.set("topic", topic);
    if (query) params.set("q", query);
    fetch(`/api/discover/${view}?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data) => {
        if (cancelled || !data) return;
        setTopics(data.topics ?? []);
        setCatalogSize(data.catalog_size ?? null);
        setTotal(data.total ?? 0);
        setPublications(data.publications ?? []);
        setArticles(data.articles ?? []);
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [user, view, topic, query, requestKey]);

  function chooseView(next: DiscoverView) {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  }

  // Subscribe and + Follow are the same action in two places: flip the flag on
  // the feed. The row stays put and turns into Following so it can be undone;
  // it leaves the catalog on the next load.
  const follow = useCallback(
    async (feedId: number, title: string) => {
      setPublications((prev) =>
        prev.map((p) => (p.id === feedId ? { ...p, is_subscribed: true } : p)),
      );
      setArticles((prev) =>
        prev.map((a) =>
          a.feed_id === feedId ? { ...a, is_subscribed: true } : a,
        ),
      );
      const response = await fetch(`/api/feeds/${feedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: true }),
      });
      if (response.ok) {
        showToast(`Subscribed to ${title}`);
      } else {
        // Put the optimistic change back rather than leave the button lying.
        setPublications((prev) =>
          prev.map((p) =>
            p.id === feedId ? { ...p, is_subscribed: false } : p,
          ),
        );
        setArticles((prev) =>
          prev.map((a) =>
            a.feed_id === feedId ? { ...a, is_subscribed: false } : a,
          ),
        );
        showToast("Could not subscribe", true);
      }
    },
    [showToast],
  );

  // Undo, while the row is still on the page. Subscribing does not remove it
  // until the next load, so the way back should be one click and not a trip to
  // Manage sources.
  const unfollow = useCallback(
    async (feedId: number, title: string) => {
      setPublications((prev) =>
        prev.map((p) => (p.id === feedId ? { ...p, is_subscribed: false } : p)),
      );
      setArticles((prev) =>
        prev.map((a) =>
          a.feed_id === feedId ? { ...a, is_subscribed: false } : a,
        ),
      );
      const response = await fetch(`/api/feeds/${feedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: false }),
      });
      showToast(
        response.ok ? `${title} is back in Discover` : "Could not undo",
        !response.ok,
      );
    },
    [showToast],
  );

  // The other half of Subscribe. A catalog that refills itself every day has
  // to be answerable, or a publication you don't want is back tomorrow: the
  // host is remembered server-side and the suggestion runs treat it as known.
  const dismiss = useCallback(
    async (feedId: number, title: string) => {
      setPublications((prev) => prev.filter((p) => p.id !== feedId));
      setArticles((prev) => prev.filter((a) => a.feed_id !== feedId));
      const response = await fetch(`/api/discover/publications/${feedId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setTotal((prev) => Math.max(0, prev - 1));
        setCatalogSize((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
        showToast(`Removed ${title} from Discover`);
      } else {
        // Nothing was removed, so put the catalog back as it was.
        setReloadToken((prev) => prev + 1);
        showToast("Could not remove that publication", true);
      }
    },
    [showToast],
  );

  // Saving keeps working on a catalog article: Read later stores a snapshot by
  // link, so it survives the publication never being subscribed to and the
  // article being trimmed out of the shallow catalog window.
  // Clicking a filled bookmark takes it back off the list: a state you can
  // reach but not leave is a trap, and this is the same control either way.
  const save = useCallback(
    async (article: CatalogArticleDto) => {
      if (savedLinks.has(article.link)) {
        const result = await removeFromReadingList(article.link);
        if (result.ok) {
          setReadingCount((prev) => Math.max(0, prev - 1));
          setSavedLinks((prev) => {
            const next = new Set(prev);
            next.delete(article.link);
            return next;
          });
        }
        showToast(result.message, !result.ok);
        return;
      }
      const result = await saveToReadingList({
        id: article.id,
        feed_id: article.feed_id,
        title: article.title,
        link: article.link,
        summary: article.summary,
        image_url: article.image_url,
        published_at: article.published_at,
        topic: article.topic,
        feed_title: article.feed_title,
      });
      if (result.ok) {
        setReadingCount((prev) => prev + 1);
        setSavedLinks((prev) => new Set(prev).add(article.link));
      }
      showToast(result.message, !result.ok);
    },
    [showToast, savedLinks],
  );

  async function addByUrl() {
    setAdding(true);
    try {
      const url = search.trim();
      const response = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
        }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        showToast(`Added ${body?.title ?? "the feed"}`);
        setSearch("");
      } else {
        showToast(body?.error ?? "Could not add that feed", true);
      }
    } finally {
      setAdding(false);
    }
  }

  const isUrl = looksLikeUrl(search);
  const shown = view === "publications" ? publications.length : articles.length;

  return (
    <div className="min-h-screen">
      <TopBar username={user?.username} />
      <div className="flex">
        <Sidebar
          feeds={feeds}
          folders={folders}
          selection={null}
          readingCount={readingCount}
        />
        <main className="mx-auto min-w-0 max-w-[1180px] flex-1 px-5 pt-[26px] pb-10 md:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="font-serif text-[26px] text-ink">Discover</h1>
            <Link href="/" className="text-sm text-clay hover:underline">
              ← Feed
            </Link>
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">
            {catalogSize === null
              ? "Publications you don't subscribe to."
              : `${catalogSize} publication${catalogSize === 1 ? "" : "s"} in the catalog, ranked by what you read and save.`}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex min-w-[260px] flex-1 items-center gap-2.5 rounded-xl border border-line bg-paper-raised px-3.5 py-[11px]">
              <span className="text-ink-faint">
                <SearchIcon />
              </span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && isUrl && !adding) addByUrl();
                }}
                placeholder="Search the catalog, or paste a feed URL to add it directly"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
              {isUrl && (
                <button
                  onClick={addByUrl}
                  disabled={adding}
                  className="shrink-0 rounded-full bg-clay px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:brightness-95 disabled:opacity-60"
                >
                  {adding ? "Adding…" : "Add this feed"}
                </button>
              )}
            </div>
            <div className="flex gap-1 rounded-full border border-line bg-paper-raised p-[3px]">
              {VIEWS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => chooseView(option.value)}
                  className={`rounded-full px-4 py-[7px] text-[13px] transition ${
                    view === option.value
                      ? "bg-ink font-medium text-paper"
                      : "text-ink-faint hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {topics.length > 0 && (
            // One line on a mouse, with the tail folded behind +N; a scrolling
            // row on a finger, where a wrapped row of topics pushes the
            // catalog itself off the screen.
            <div className="no-scrollbar mt-3.5 flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
              <button
                onClick={() => setTopic("")}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap transition pointer-coarse:min-h-11 ${
                  topic === ""
                    ? "bg-ink text-paper"
                    : "border border-line bg-paper-raised text-ink-soft hover:text-ink"
                }`}
              >
                All topics
              </button>
              {topics.map((entry) => (
                <button
                  key={entry.topic}
                  onClick={() => setTopic(entry.topic)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap transition pointer-coarse:min-h-11 ${
                    topic === entry.topic
                      ? "bg-ink text-paper"
                      : "border border-line bg-paper-raised text-ink-soft hover:text-ink"
                  }`}
                >
                  {entry.topic}{" "}
                  <span
                    className={
                      topic === entry.topic ? "opacity-70" : "text-ink-faint"
                    }
                  >
                    {entry.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="py-24 text-center text-ink-faint">Loading…</p>
          ) : shown === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-20 text-center">
              <p className="font-serif text-xl text-ink">Nothing here yet</p>
              <p className="max-w-sm text-sm text-ink-faint">
                {query || topic
                  ? "No publication in the catalog matches that. Try another topic, or paste a feed URL to add one directly."
                  : "The catalog is empty. Paste a feed URL above to add a publication."}
              </p>
            </div>
          ) : view === "publications" ? (
            <div className="mt-6 flex flex-col gap-5">
              {publications.map((publication) => (
                <PublicationBlock
                  key={publication.id}
                  publication={publication}
                  onSubscribe={() => follow(publication.id, publication.title)}
                  onDismiss={() => dismiss(publication.id, publication.title)}
                  onUndo={() => unfollow(publication.id, publication.title)}
                  onSave={save}
                  savedLinks={savedLinks}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  onFollow={() => follow(article.feed_id, article.feed_title)}
                  onSave={save}
                  onDismiss={() => dismiss(article.feed_id, article.feed_title)}
                  saved={savedLinks.has(article.link)}
                />
              ))}
            </div>
          )}

          {/* Same sentinel the home grid uses: the observer picks it up 600px
            before it reaches the viewport, so the next page is already in
            flight by the time the last card is read. */}
          <div ref={sentinelRef} className="h-px" />
          {!loading && shown > 0 && shown < total && (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              Loading more…
            </p>
          )}
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
