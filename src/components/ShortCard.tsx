"use client";

import { useState } from "react";
import { type ArticleDto, feedTone, timeAgo } from "@/lib/types";
import { saveToReadingList, sendToOmnivore, unlockUrl } from "@/lib/actions";
import { FeedAvatar } from "./FeedAvatar";
import {
  BookmarkIcon,
  SendIcon,
  SwipeableCard,
  UnlockIcon,
} from "./SwipeableCard";

export function ShortCard({
  article,
  index,
  onToast,
}: {
  article: ArticleDto;
  index: number;
  onToast: (message: string, error?: boolean) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image_url && !imageFailed;
  const tone = feedTone(article.feed_id);

  async function handleSave() {
    const result = await saveToReadingList(article);
    onToast(result.message, !result.ok);
  }

  async function handleOmnivore() {
    const result = await sendToOmnivore(article);
    onToast(result.message, !result.ok);
  }

  return (
    <section
      data-index={index}
      className="flex h-full snap-start items-center justify-center px-4 py-20 md:px-8"
    >
      <SwipeableCard
        onSwipeRight={handleSave}
        onSwipeLeft={handleOmnivore}
        rightLabel="Read later"
        leftLabel="To Omnivore"
        className="max-h-full w-full max-w-xl"
      >
        <article className="flex max-h-[calc(100dvh-10rem)] w-full flex-col overflow-hidden rounded-3xl border border-line bg-paper-raised shadow-[0_20px_60px_-30px_rgba(31,30,27,0.35)]">
          <div className="relative shrink-0">
            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={article.image_url!}
                alt=""
                onError={() => setImageFailed(true)}
                className="h-52 w-full object-cover md:h-64"
              />
            ) : (
              <div
                className="flex h-36 w-full items-center justify-center md:h-44"
                style={{
                  background: `linear-gradient(135deg, ${tone}1d, ${tone}4d)`,
                }}
              >
                <span
                  className="font-serif text-7xl opacity-35"
                  style={{ color: tone }}
                >
                  {article.feed_title.charAt(0)}
                </span>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-7 md:p-8">
            <div className="flex items-center gap-2.5">
              <FeedAvatar
                feedId={article.feed_id}
                title={article.feed_title}
                siteUrl={article.link}
                size={26}
              />
              <span className="text-[13px] font-medium text-ink-soft">
                {article.feed_title}
              </span>
              {article.published_at && (
                <span className="text-[13px] text-ink-faint">
                  · {timeAgo(article.published_at)}
                </span>
              )}
            </div>

            <h2 className="font-serif text-2xl leading-snug text-ink md:text-[28px]">
              {article.title}
            </h2>

            {article.summary && (
              <p className="text-[15px] leading-relaxed text-ink-soft">
                {article.summary}
              </p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-clay px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-95"
              >
                Read the article →
              </a>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm text-ink-soft transition hover:border-clay hover:text-clay"
              >
                <BookmarkIcon size={14} /> Read later
              </button>
              <button
                onClick={handleOmnivore}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm text-ink-soft transition hover:border-clay hover:text-clay"
              >
                <SendIcon size={14} /> Omnivore
              </button>
              <a
                href={unlockUrl(article.link)}
                target="_blank"
                rel="noopener noreferrer"
                title="Read without paywall via Marreta"
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm text-ink-soft transition hover:border-clay hover:text-clay"
              >
                <UnlockIcon size={14} /> No paywall
              </a>
            </div>
          </div>
        </article>
      </SwipeableCard>
    </section>
  );
}
