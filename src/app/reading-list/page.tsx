"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type ArticleDto,
  type FeedDto,
  type FolderDto,
  type ReadingItemDto,
  timeAgo,
} from "@/lib/types";
import {
  cachedImageUrl,
  recordEvent,
  removeFromReadingList,
  saveToReadingList,
  unlockUrl,
} from "@/lib/actions";
import { Toast, useToast } from "@/components/Toast";
import { Menu, separator } from "@/components/ui/Menu";
import { Segmented } from "@/components/ui/Segmented";
import { partialProgress, readProgress } from "@/lib/readProgress";
import { highlightCounts } from "@/lib/highlights";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SurveyDialog, type SurveyChoice } from "@/components/SurveyDialog";
import { Reader, after } from "@/components/Reader";
import { readerLink, useReader } from "@/lib/useReader";
import { useUser } from "@/lib/useUser";

// A saved snapshot, seen as the article the reader needs. Read later stores
// its own copy of title, summary and cover, so everything but the ids is
// already here.
function asArticle(item: ReadingItemDto): ArticleDto | null {
  if (item.article_id === null) return null;
  return {
    id: item.article_id,
    feed_id: item.feed_id ?? 0,
    title: item.title,
    link: item.link,
    summary: item.summary,
    image_url: item.image_url,
    published_at: item.published_at,
    topic: null,
    feed_title: item.feed_title ?? "",
  };
}

type Sort = "newest" | "oldest" | "shortest";

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  // The one that gets a list like this used: seven minutes free, find
  // something that fits in them.
  { value: "shortest", label: "Shortest" },
];

function savedAt(item: ReadingItemDto): number {
  // SQLite writes UTC with a space and no marker; parsed as-is it lands in
  // local time and everything saved today looks hours old.
  return new Date(item.added_at.replace(" ", "T") + "Z").getTime();
}

// The heading a saved item files under. Weeks near the top, because that is
// the resolution you remember saving things at; months once it is history.
function groupOf(item: ReadingItemDto, now: number): string {
  const age = now - savedAt(item);
  const day = 24 * 3_600_000;
  if (age < 7 * day) return "This week";
  if (age < 30 * day) return "Earlier this month";
  return new Date(savedAt(item)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function readingClause(items: ReadingItemDto[]): string {
  const known = items.filter((item) => item.reading_minutes);
  // Below this the total would be a guess dressed as a number: an article
  // whose text was never extracted has no length, and quietly leaving it out
  // under-reports the queue.
  if (known.length < items.length * 0.6) return "";
  const minutes = known.reduce((sum, item) => sum + (item.reading_minutes ?? 0), 0);
  const scaled = Math.round((minutes / known.length) * items.length);
  if (scaled < 1) return "";
  const hours = Math.floor(scaled / 60);
  const rest = scaled % 60;
  const spelled = hours ? `${hours} h${rest ? ` ${rest} m` : ""}` : `${rest} m`;
  return `about ${spelled} of reading`;
}

export default function ReadingListPage() {
  const user = useUser();
  const [items, setItems] = useState<ReadingItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [surveyItem, setSurveyItem] = useState<ReadingItemDto | null>(null);
  // Un-saving from the reader takes the item straight off the list, so this is
  // only ever "the one the reader is showing, which I just un-saved and might
  // put back".
  const [unsaved, setUnsaved] = useState<ArticleDto | null>(null);
  const { toast, showToast } = useToast();
  // The rail names every destination, so it needs the same feeds and folders
  // the home grid draws. Two reads of already-cached routes.
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  // Fixed for the life of the page: "this week" must not move under a
  // re-render, and a Read later session does not outlive a week.
  const [now] = useState(() => Date.now());
  // Where the reader left off, per article. Read straight from the same map
  // the reader writes; it is a scroll position in this browser, not a fact
  // about the article, and it is honest about that.
  const [progress, setProgress] = useState<Record<string, number>>({});
  // How many passages are kept in each saved article — the reason to come back
  // to one. Counted server-side and fetched once, not per row.
  const [highlights, setHighlights] = useState<Map<string, number>>(new Map());
  // Set by the highlight chip, so the reader opens on the list rather than on
  // the top of an article you have already read.
  const [openHighlights, setOpenHighlights] = useState(false);

  const resolveArticle = useCallback(
    async (id: number): Promise<ArticleDto | null> => {
      const saved = items.find((item) => item.article_id === id);
      if (saved) return asArticle(saved);
      const response = await fetch(`/api/articles/${id}`);
      return response.ok ? ((await response.json()) as ArticleDto) : null;
    },
    [items]
  );
  const reader = useReader(resolveArticle);

  // The rest of the list, so finishing one saved article offers the next.
  const upNext = after(
    items,
    items.findIndex((item) => item.article_id === reader.article?.id)
  )
    .map(asArticle)
    .filter((article): article is ArticleDto => article !== null);

  useEffect(() => {
    if (!user) return;
    fetch("/api/reading-list")
      .then((response) => response.json())
      .then(setItems)
      .finally(() => setLoading(false));
    fetch("/api/feeds")
      .then((response) => response.json())
      .then((data) => setFeeds(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/folders")
      .then((response) => response.json())
      .then((data) => setFolders(Array.isArray(data) ? data : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is not readable during render
    setProgress(readProgress());
    highlightCounts().then(setHighlights);
  }, [user]);

  // On this page a save is the reason the row exists, so un-saving removes it
  // rather than leaving a Read later list with something that isn't saved.
  // Putting it back reloads the list, which also restores its place in it.
  async function toggleSave(article: ArticleDto) {
    if (unsaved?.link === article.link) {
      const result = await saveToReadingList(article);
      showToast(result.message, !result.ok);
      if (!result.ok) return;
      setUnsaved(null);
      const response = await fetch("/api/reading-list");
      setItems(await response.json());
      return;
    }
    const result = await removeFromReadingList(article.link);
    showToast(result.message, !result.ok);
    if (!result.ok) return;
    setUnsaved(article);
    setItems((previous) => previous.filter((it) => it.link !== article.link));
  }

  // Sorted, then grouped — and grouped only when the order is chronological.
  // "Shortest" answers a different question, and heading it with "This week"
  // would suggest a chronology the list no longer has.
  const ordered = [...items].sort((a, b) => {
    if (sort === "shortest") {
      // Unknown length sorts last rather than first: an article whose text was
      // never extracted is not a two-minute read, it is an unknown one.
      const left = a.reading_minutes ?? Number.MAX_SAFE_INTEGER;
      const right = b.reading_minutes ?? Number.MAX_SAFE_INTEGER;
      return left - right;
    }
    return sort === "oldest"
      ? savedAt(a) - savedAt(b)
      : savedAt(b) - savedAt(a);
  });

  const sorted: Array<{ label: string; items: ReadingItemDto[] }> = [];
  for (const item of ordered) {
    const label = sort === "shortest" ? "" : groupOf(item, now);
    const last = sorted[sorted.length - 1];
    if (last && last.label === label) last.items.push(item);
    else sorted.push({ label, items: [item] });
  }

  async function finishSurvey(item: ReadingItemDto, choice: SurveyChoice) {
    setSurveyItem(null);
    recordEvent(item.link, choice, item.title);
    await fetch(`/api/reading-list/${item.id}`, { method: "DELETE" });
    setItems((previous) => previous.filter((it) => it.id !== item.id));
    showToast(
      choice === "like"
        ? "Removed — glad you liked it"
        : choice === "dislike"
          ? "Removed — noted, less like this"
          : "Removed from Read later"
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar username={user?.username} />
      <div className="flex">
        <Sidebar
          feeds={feeds}
          folders={folders}
          selection={null}
          readingCount={items.length}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="mx-auto min-w-0 max-w-[760px] flex-1 px-5 py-8 md:px-8">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl text-ink">Read later</h1>
            {/* The size of the queue in the unit you decide by. A count alone
                does not tell you whether this is an evening or a month. */}
            {items.length > 0 && (
              <p className="mt-1 text-[13px] text-ink-faint pointer-coarse:text-[14.5px]">
                {items.length} saved
                {readingClause(items) && (
                  <>
                    <span className="mx-1.5">·</span>
                    {readingClause(items)}
                  </>
                )}
              </p>
            )}
          </div>
          {/* The rail is the way back, but it stops at lg and an iPad in
              portrait is 834px. Kept below that, dropped above it. */}
          <Link
            href="/"
            className="shrink-0 text-sm text-clay hover:underline lg:hidden"
          >
            ← Back to feed
          </Link>
        </div>

        {items.length > 1 && (
          <div className="mt-5 flex justify-end">
            <Segmented
              options={SORTS}
              value={sort}
              onChange={setSort}
              ariaLabel="Sort saved articles"
            />
          </div>
        )}

        {loading ? (
          <p className="py-20 text-center text-ink-faint">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-serif text-xl text-ink">Nothing saved yet</p>
            <p className="max-w-sm text-sm text-ink-faint">
              Swipe a card to the right (or use the bookmark button) and the
              article will wait for you here.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            {sorted.map((group) => (
              <section key={group.label} className="mb-7 last:mb-0">
                {/* A date heading instead of the twentieth identical row. In
                    Shortest order there is only one group: length and date are
                    different questions and interleaving them answers neither. */}
                {group.label && (
                  <h2 className="mb-2.5 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
                    {group.label}
                  </h2>
                )}
                <ul className="space-y-3">
                  {group.items.map((item) => {
                    const article = asArticle(item);
                    const read = partialProgress(progress, item.article_id);
                    const kept = highlights.get(item.link) ?? 0;
                    return (
                      <li
                        key={item.id}
                        className="flex flex-col gap-3 rounded-2xl border border-line bg-paper-raised p-4 transition hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.2)] sm:flex-row sm:items-center sm:gap-4"
                      >
                        <div className="flex min-w-0 flex-1 gap-4">
                          {item.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={cachedImageUrl(item.image_url)}
                              alt=""
                              loading="lazy"
                              width={128}
                              height={80}
                              className="hidden h-20 w-32 shrink-0 rounded-xl object-cover sm:block"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            {/* The reader when the article is still on file;
                                the unlock route when it isn't, so an old save
                                never becomes a dead headline. */}
                            {article ? (
                              <a
                                {...readerLink(article, reader.open)}
                                className="line-clamp-2 font-serif text-[16px] leading-snug font-medium text-ink hover:text-clay pointer-coarse:text-[19px]"
                              >
                                {item.title}
                              </a>
                            ) : (
                              <a
                                href={unlockUrl(item.link)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Opens paywall-free via Marreta"
                                className="line-clamp-2 font-serif text-[16px] leading-snug font-medium text-ink hover:text-clay pointer-coarse:text-[19px]"
                              >
                                {item.title}
                              </a>
                            )}
                            <p className="mt-1 text-[13px] text-ink-faint pointer-coarse:text-[14px]">
                              {item.feed_title}
                              {item.feed_title && <span className="mx-1.5">·</span>}
                              saved{" "}
                              {timeAgo(item.added_at.replace(" ", "T") + "Z") ||
                                "just now"}
                              {kept > 0 && (
                                <>
                                  <span className="mx-1.5">·</span>
                                  <a
                                    {...(article
                                      ? readerLink(article, reader.open)
                                      : { href: item.link })}
                                    onClick={(event) => {
                                      setOpenHighlights(true);
                                      if (article) {
                                        readerLink(article, reader.open).onClick(event);
                                      }
                                    }}
                                    className="rounded-full bg-clay-soft px-2 py-0.5 text-[12px] text-clay"
                                  >
                                    {kept} highlight{kept === 1 ? "" : "s"}
                                  </a>
                                </>
                              )}
                              {item.reading_minutes && (
                                <>
                                  <span className="mx-1.5">·</span>
                                  {item.reading_minutes} min
                                </>
                              )}
                              {read !== null && (
                                <>
                                  <span className="mx-1.5">·</span>
                                  <span className="text-clay">
                                    {Math.round(read * 100)}% read
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* One row of controls, all of them labelled. The
                            remove button used to be a × that appeared on
                            hover, over the row it would delete. */}
                        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                          {article ? (
                            <a
                              {...readerLink(article, reader.open)}
                              className="rounded-full bg-clay px-4 py-1.5 text-[13px] text-white transition hover:opacity-90 pointer-coarse:min-h-11 pointer-coarse:px-5 pointer-coarse:text-[15px]"
                            >
                              {read !== null ? "Continue" : "Read"}
                            </a>
                          ) : (
                            <a
                              href={unlockUrl(item.link)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-full bg-clay px-4 py-1.5 text-[13px] text-white transition hover:opacity-90 pointer-coarse:min-h-11 pointer-coarse:px-5 pointer-coarse:text-[15px]"
                            >
                              Read
                            </a>
                          )}
                          <Menu
                            items={[
                              {
                                label: "Open the original",
                                onSelect: () => {
                                  recordEvent(item.link, "open", item.title);
                                  window.open(item.link, "_blank", "noopener");
                                },
                              },
                              separator("remove"),
                              {
                                label: "Remove from Read later",
                                destructive: true,
                                onSelect: () => setSurveyItem(item),
                              },
                            ]}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
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
          originLabel="Read later"
          upNext={upNext}
          saved={unsaved?.link !== reader.article.link}
          onToggleSave={() => toggleSave(reader.article!)}
          onToast={showToast}
          showHighlights={openHighlights}
          onOpenArticle={reader.open}
          onClose={() => {
            reader.close();
            setOpenHighlights(false);
            // The reader is an overlay on this page: closing it is exactly
            // when the row behind it learns how far you got.
            setProgress(readProgress());
          }}
        />
      )}
      {surveyItem && (
        <SurveyDialog
          item={surveyItem}
          onChoose={(choice) => finishSurvey(surveyItem, choice)}
          onClose={() => setSurveyItem(null)}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
