"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  feedTone,
  timeAgo,
  type ArticleDto,
  type DigestDto,
  type DigestItemDto,
  type DigestKind,
  type FeedDto,
  type FolderDto,
} from "@/lib/types";
import {
  cachedImageUrl,
  recordEvent,
  removeFromReadingList,
  saveToReadingList,
} from "@/lib/actions";
import { FeedAvatar } from "@/components/FeedAvatar";
import { TopBar } from "@/components/TopBar";
import { Toast, useToast } from "@/components/Toast";
import { BookmarkIcon } from "@/components/SwipeableCard";
import { Reader, after } from "@/components/Reader";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { readerLink, useReader } from "@/lib/useReader";
import { useUser } from "@/lib/useUser";

// A digest item seen as the article every other part of the app deals in. The
// stored annotation travels as the summary: it is a better teaser than the
// feed's own, and it is what the reader shows above the rule.
function asArticle(item: DigestItemDto): ArticleDto {
  return {
    id: item.article_id,
    feed_id: item.feed_id,
    title: item.title,
    link: item.link,
    summary: item.summary,
    image_url: item.image_url,
    published_at: item.published_at,
    topic: item.topic,
    feed_title: item.feed_title,
  };
}

interface Schedule {
  daily: string;
  weekly: string;
  timeZone: string;
}

interface DigestResponse {
  kind: DigestKind;
  digest: DigestDto | null;
  schedule: Schedule;
}

const KINDS: Array<{ value: DigestKind; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const SECTION_LABEL =
  "text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase";
const PANEL = "rounded-[14px] border border-line bg-paper-raised p-[18px]";

// The feed-tone wash the design uses wherever an article has no cover of its
// own. Inline because the tone is per-feed and Tailwind can't see it.
function toneGradient(feedId: number): string {
  const tone = feedTone(feedId);
  return `linear-gradient(135deg, ${tone}20, ${tone}55)`;
}

function Cover({ item }: { item: DigestItemDto }) {
  if (item.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cachedImageUrl(item.image_url)}
        alt=""
        className="aspect-[21/9] w-full object-cover"
      />
    );
  }
  // No cover anywhere: set the headline over the feed's tint rather than
  // leaving a blank block, the same fallback the grid cards use.
  return (
    <div
      className="flex aspect-[21/9] items-end p-5"
      style={{ background: toneGradient(item.feed_id) }}
    >
      <span className="line-clamp-2 font-serif text-[22px] leading-tight text-ink">
        {item.title}
      </span>
    </div>
  );
}

function Meta({ item }: { item: DigestItemDto }) {
  return (
    <>
      {item.feed_title}
      <span className="mx-1.5">·</span>
      {timeAgo(item.published_at)}
      {item.reading_minutes ? (
        <>
          <span className="mx-1.5">·</span>
          {item.reading_minutes} min read
        </>
      ) : null}
    </>
  );
}

export default function DigestPage() {
  const user = useUser();
  const [kind, setKind] = useState<DigestKind>("daily");
  // Both snapshots are already built, so switching is a read — cache them and
  // the toggle never shows a spinner twice.
  const [loaded, setLoaded] = useState<
    Partial<Record<DigestKind, DigestDto | null>>
  >({});
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The digest is a reading page and keeps its centred column — no rail down
  // the side. But below lg there is no rail anywhere, and this was the one
  // page you could not get out of except back to the feed, so the same rows
  // are available here from the menu.
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [readingCount, setReadingCount] = useState(0);

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
    void fetch("/api/reading-list")
      .then((response) => response.json())
      .then((data) => setReadingCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, [user]);
  // Links already in Read later, so the reader's bookmark pill starts right.
  const [savedLinks, setSavedLinks] = useState<Set<string>>(new Set());
  const { toast, showToast } = useToast();

  // A kind is "loaded" once its key exists, even when the value is null — a
  // period with no digest is an answer, not a pending request.
  const loading = !user || !(kind in loaded);

  useEffect(() => {
    if (!user || kind in loaded) return;
    let cancelled = false;
    fetch(`/api/digest?kind=${kind}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data: DigestResponse | null) => {
        if (cancelled) return;
        setLoaded((previous) => ({
          ...previous,
          [kind]: data?.digest ?? null,
        }));
        if (data?.schedule) setSchedule(data.schedule);
        // Opening the daily digest is what clears the sidebar's "today"
        // marker. Nothing server-side records a read — this is the whole of
        // that state, and it is honest about being per-browser.
        if (kind === "daily" && data?.digest) {
          window.localStorage.setItem("ms_digest_seen", data.digest.period_key);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, kind, loaded]);

  useEffect(() => {
    if (!user) return;
    fetch("/api/reading-list")
      .then((response) => response.json())
      .then((saved: Array<{ link: string }>) => {
        if (Array.isArray(saved)) {
          setSavedLinks(new Set(saved.map((entry) => entry.link)));
        }
      })
      .catch(() => {});
  }, [user]);

  const digest = loaded[kind] ?? null;
  const items = (digest?.items ?? []).filter(
    (item) => !skipped.includes(item.link),
  );
  // Skipping the lead promotes the next highlight rather than leaving a hole
  // where the main card was.
  const highlights = items
    .filter((item) => item.section === "lead" || item.section === "also")
    .sort((a, b) =>
      a.section === b.section
        ? a.position - b.position
        : a.section === "lead"
          ? -1
          : 1,
    );
  const [lead, ...also] = highlights;
  const quick = items.filter((item) => item.section === "quick");
  const rest = items.filter((item) => item.section === "rest");

  // The digest's own running order, which is also the order "Up next" follows:
  // the lead, then the runners-up, then the quick hits.
  const reading = [...highlights, ...quick];

  // Not memoized: `items` is derived from the snapshot every render, so a
  // dependency array here would be a lie the React Compiler is right to
  // reject. useReader keeps the latest resolver in a ref anyway.
  async function resolveArticle(id: number): Promise<ArticleDto | null> {
    const item = items.find((entry) => entry.article_id === id);
    if (item) return asArticle(item);
    const response = await fetch(`/api/articles/${id}`);
    return response.ok ? ((await response.json()) as ArticleDto) : null;
  }
  const reader = useReader(resolveArticle);

  const upNext = after(
    reading,
    reading.findIndex((item) => item.article_id === reader.article?.id),
  ).map(asArticle);

  const readLater = useCallback(
    async (item: DigestItemDto) => {
      const result = await saveToReadingList(asArticle(item));
      showToast(result.message, !result.ok);
      if (result.ok) {
        setSavedLinks((previous) => new Set(previous).add(item.link));
      }
    },
    [showToast],
  );

  async function toggleSave(article: ArticleDto) {
    if (!savedLinks.has(article.link)) {
      // The reader may be showing something this digest doesn't list — a
      // pasted ?article= link, or a card skipped earlier in the session. Save
      // what the reader has rather than doing nothing at all: the annotation
      // is a nicety, a control that silently ignores a click is not.
      const item = items.find((entry) => entry.article_id === article.id);
      if (item) {
        await readLater(item);
        return;
      }
      const result = await saveToReadingList(article);
      showToast(result.message, !result.ok);
      if (result.ok) {
        setSavedLinks((previous) => new Set(previous).add(article.link));
      }
      return;
    }
    const result = await removeFromReadingList(article.link);
    showToast(result.message, !result.ok);
    if (result.ok) {
      setSavedLinks((previous) => {
        const next = new Set(previous);
        next.delete(article.link);
        return next;
      });
    }
  }

  const skip = useCallback(
    (item: DigestItemDto) => {
      recordEvent(item.link, "skip", item.title);
      // The GET filter drops skipped links from the snapshot, so this
      // survives a reload without touching the digest itself.
      setSkipped((previous) => [...previous, item.link]);
      showToast("Skipped — you won't see it here again");
    },
    [showToast],
  );

  const eyebrow = digest
    ? new Date(digest.period_end).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

  const highlightCount = highlights.length + quick.length;

  return (
    <div className="min-h-screen">
      <TopBar
        username={user?.username}
        nav={
          <Sidebar
            feeds={feeds}
            folders={folders}
            selection={null}
            readingCount={readingCount}
            onOpenSettings={() => setSettingsOpen(true)}
            variant="sheet"
          />
        }
      />
      <main className="mx-auto max-w-[1080px] px-5 pt-9 pb-10 md:px-11">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className={`${SECTION_LABEL} mb-1.5`}>{eyebrow}</p>
            <h1 className="font-serif text-[38px] leading-[1.1] text-ink">
              Your digest
            </h1>
            <p className="mt-2.5 max-w-xl text-sm text-ink-soft">
              {digest
                ? `${digest.total_articles} new article${
                    digest.total_articles === 1 ? "" : "s"
                  } across ${digest.total_publications} publication${
                    digest.total_publications === 1 ? "" : "s"
                  }. Here ${highlightCount === 1 ? "is" : "are"} the ${highlightCount} worth your ${
                    kind === "daily" ? "morning" : "week"
                  }, then everything else.`
                : "A short, finite read of what arrived while you were away."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5 rounded-full border border-line p-[3px]">
              {KINDS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setKind(option.value);
                    setShowAll(false);
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs transition ${
                    kind === option.value
                      ? "bg-clay text-white"
                      : "text-ink-faint hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Link href="/" className="text-sm text-clay hover:underline">
              ← Feed
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="py-24 text-center text-ink-faint">Loading…</p>
        ) : !digest || items.length === 0 ? (
          <div className="mt-7 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-20 text-center">
            <p className="font-serif text-xl text-ink">No {kind} digest yet</p>
            <p className="max-w-md text-sm text-ink-faint">
              {schedule
                ? `The ${kind} digest is built at ${
                    kind === "daily" ? schedule.daily : schedule.weekly
                  } (${schedule.timeZone}) from the folders that feed For you. ` +
                  "If nothing new arrived in the period, there is nothing to digest."
                : "Nothing to digest for this period yet."}
            </p>
          </div>
        ) : (
          <div className="mt-7 flex flex-col gap-8 lg:flex-row">
            <div className="min-w-0 flex-[1.55]">
              {lead && (
                <>
                  <p className={`${SECTION_LABEL} mb-3.5`}>The lead</p>
                  <div className="overflow-hidden rounded-2xl border border-line bg-paper-raised">
                    <Cover item={lead} />
                    <div className="p-[22px]">
                      <div className="mb-2.5 flex items-center gap-2">
                        <FeedAvatar
                          feedId={lead.feed_id}
                          title={lead.feed_title}
                          siteUrl={lead.site_url}
                          size={20}
                        />
                        <span className="text-[12.5px] text-ink-faint">
                          <Meta item={lead} />
                        </span>
                      </div>
                      <h2 className="font-serif text-[26px] leading-[1.25] font-medium text-ink">
                        {lead.title}
                      </h2>
                      {lead.summary && (
                        <p className="mt-3 text-[14.5px] leading-[1.6] text-ink-soft">
                          {lead.summary}
                        </p>
                      )}
                      <div className="mt-[18px] flex flex-wrap gap-2.5">
                        <a
                          {...readerLink(asArticle(lead), reader.open)}
                          className="rounded-full bg-clay px-4 py-2.5 text-[13px] font-medium text-white transition hover:brightness-95"
                        >
                          Read here
                        </a>
                        <button
                          onClick={() => readLater(lead)}
                          className="flex items-center gap-[7px] rounded-full border border-line px-4 py-2.5 text-[13px] text-ink-soft transition hover:border-clay hover:text-clay"
                        >
                          <BookmarkIcon size={13} />
                          Read later
                        </button>
                        <button
                          onClick={() => skip(lead)}
                          className="rounded-full border border-line px-4 py-2.5 text-[13px] text-ink-faint transition hover:border-clay hover:text-clay"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {also.length > 0 && (
                <>
                  <p className={`${SECTION_LABEL} mt-7 mb-3.5`}>
                    Also worth it
                  </p>
                  <div className="flex flex-col gap-3.5">
                    {also.map((item) => (
                      <div
                        key={item.article_id}
                        className="flex gap-3.5 rounded-[14px] border border-line bg-paper-raised p-4"
                      >
                        {/* 16:9, because that is the shape article covers
                            actually come in — the square this used to be threw
                            away two fifths of every frame and left the subject
                            too small to read. */}
                        {item.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={cachedImageUrl(item.image_url)}
                            alt=""
                            loading="lazy"
                            className="hidden aspect-video w-44 shrink-0 self-start rounded-[10px] object-cover sm:block"
                          />
                        ) : (
                          <div
                            className="hidden aspect-video w-44 shrink-0 self-start rounded-[10px] sm:block"
                            style={{ background: toneGradient(item.feed_id) }}
                          />
                        )}
                        <div className="min-w-0">
                          <a
                            {...readerLink(asArticle(item), reader.open)}
                            className="font-serif text-[17px] leading-[1.3] font-medium text-ink hover:text-clay"
                          >
                            {item.title}
                          </a>
                          {item.summary && (
                            <p className="mt-[7px] text-[13px] leading-[1.5] text-ink-soft">
                              {item.summary}
                            </p>
                          )}
                          <p className="mt-2.5 flex flex-wrap items-center text-[12.5px] text-ink-faint">
                            <Meta item={item} />
                            <button
                              onClick={() => readLater(item)}
                              className="ml-3 text-ink-faint transition hover:text-clay"
                            >
                              Read later
                            </button>
                            <button
                              onClick={() => skip(item)}
                              className="ml-3 text-ink-faint transition hover:text-clay"
                            >
                              Skip
                            </button>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-[22px] lg:w-[280px]">
              {digest.three_lines.length > 0 && (
                <div className={PANEL}>
                  <p className={`${SECTION_LABEL} mb-3`}>In three lines</p>
                  <div className="flex flex-col gap-[11px]">
                    {digest.three_lines.map((line, index) => (
                      <p
                        key={index}
                        className="text-[13.5px] leading-[1.5] text-ink"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {(quick.length > 0 || rest.length > 0) && (
                <div className={PANEL}>
                  <p className={`${SECTION_LABEL} mb-3`}>Quick hits</p>
                  <div className="flex flex-col gap-3">
                    {(showAll ? [...quick, ...rest] : quick).map((item) => (
                      <p
                        key={item.article_id}
                        className="text-[13px] leading-[1.4] text-ink-soft"
                      >
                        <a
                          {...readerLink(asArticle(item), reader.open)}
                          className="text-ink hover:text-clay"
                        >
                          {item.title}
                        </a>
                        {" — "}
                        {item.feed_title}
                      </p>
                    ))}
                  </div>
                  {rest.length > 0 && (
                    // Expands in place: the rest of the period is part of the
                    // snapshot, so this never leaves the page.
                    <button
                      onClick={() => setShowAll((previous) => !previous)}
                      className="mt-3.5 text-[12.5px] text-clay hover:underline"
                    >
                      {showAll
                        ? "Show fewer"
                        : `Show all ${rest.length} remaining →`}
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-[14px] border border-dashed border-line p-[18px] text-left transition hover:border-clay"
              >
                <p className="mb-2 text-[13px] font-medium text-ink">
                  Digest settings
                </p>
                <p className="text-[12.5px] leading-[1.5] text-ink-faint">
                  {schedule
                    ? `Built at ${schedule.daily}, weekly on ${schedule.weekly} (${schedule.timeZone}), from the folders you picked as sources.`
                    : "Built from the folders you picked as sources."}
                  {digest.llm_provider
                    ? ` Annotations by ${digest.llm_model}.`
                    : " No model configured — annotations are the articles' own opening lines."}
                </p>
                <p className="mt-2 text-[12.5px] text-clay">Change →</p>
              </button>
            </div>
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            // Sources, size and schedule all shape the *next* build — this
            // snapshot is frozen, so say so rather than let the page look
            // broken for not changing.
            setLoaded({});
            showToast("Saved — applies to the next digest");
          }}
        />
      )}
      {reader.article && (
        <Reader
          article={reader.article}
          originLabel="your digest"
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
