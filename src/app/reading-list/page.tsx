"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type ArticleDto, type ReadingItemDto, timeAgo } from "@/lib/types";
import {
  cachedImageUrl,
  recordEvent,
  removeFromReadingList,
  saveToReadingList,
  unlockUrl,
} from "@/lib/actions";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { ExternalIcon } from "@/components/SwipeableCard";
import { SurveyDialog, type SurveyChoice } from "@/components/SurveyDialog";
import { Reader } from "@/components/Reader";
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
  const upNext = reader.article
    ? items
        .slice(items.findIndex((item) => item.article_id === reader.article!.id) + 1)
        .map(asArticle)
        .filter((article): article is ArticleDto => article !== null)
        .slice(0, 2)
    : [];

  useEffect(() => {
    if (!user) return;
    fetch("/api/reading-list")
      .then((response) => response.json())
      .then(setItems)
      .finally(() => setLoading(false));
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
      <main className="mx-auto max-w-3xl px-5 py-8 md:px-8">
        <div className="flex items-baseline justify-between">
          <h1 className="font-serif text-3xl text-ink">Read later</h1>
          <Link href="/" className="text-sm text-clay hover:underline">
            ← Back to feed
          </Link>
        </div>

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
          <ul className="mt-6 space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="group flex gap-4 rounded-2xl border border-line bg-paper-raised p-4 transition hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.2)]"
              >
                {item.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cachedImageUrl(item.image_url)}
                    alt=""
                    loading="lazy"
                    className="hidden h-20 w-32 shrink-0 rounded-xl object-cover sm:block"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {/* The reader when the article is still on file; the
                      unlock route when it isn't, so an old save never becomes
                      a dead headline. */}
                  {asArticle(item) ? (
                    <a
                      {...readerLink(asArticle(item)!, reader.open)}
                      className="line-clamp-2 font-serif text-[16px] leading-snug font-medium text-ink hover:text-clay"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <a
                      href={unlockUrl(item.link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Opens paywall-free via Marreta"
                      className="line-clamp-2 font-serif text-[16px] leading-snug font-medium text-ink hover:text-clay"
                    >
                      {item.title}
                    </a>
                  )}
                  <p className="mt-1 text-[13px] text-ink-faint">
                    {item.feed_title}
                    {item.feed_title && <span className="mx-1.5">·</span>}
                    saved {timeAgo(item.added_at.replace(" ", "T") + "Z") || "just now"}
                  </p>
                  {item.summary && (
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-soft">
                      {item.summary}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                  <button
                    title="Remove"
                    onClick={() => setSurveyItem(item)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 pointer-coarse:opacity-100 hover:bg-paper-sunken hover:text-ink"
                  >
                    ×
                  </button>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the original"
                    className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-clay hover:text-clay"
                  >
                    <ExternalIcon size={12} /> Original
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      {reader.article && (
        <Reader
          article={reader.article}
          originLabel="Read later"
          upNext={upNext}
          saved={unsaved?.link !== reader.article.link}
          onToggleSave={() => toggleSave(reader.article!)}
          onOpenArticle={reader.open}
          onClose={reader.close}
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
