"use client";

import { useImperativeHandle, useRef, useState } from "react";
import { type ArticleDto, feedTone, timeAgo } from "@/lib/types";
import {
  cachedImageUrl,
  recordEvent,
  saveToReadingList,
  sendToOmnivore,
  unlockUrl,
} from "@/lib/actions";
import { flyBoomerang } from "@/lib/boomerang";
import { FeedAvatar } from "./FeedAvatar";
import {
  BookmarkIcon,
  ExternalIcon,
  OmnivoreIcon,
  SwipeableCard,
  type SwipeableCardHandle,
} from "./SwipeableCard";

export function ShortCard({
  article,
  index,
  onToast,
  onSaved,
  onActed,
  ref,
}: {
  article: ArticleDto;
  index: number;
  onToast: (message: string, error?: boolean) => void;
  onSaved?: () => void;
  onActed?: () => void;
  ref?: React.Ref<SwipeableCardHandle>;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image_url && !imageFailed;
  const tone = feedTone(article.feed_id);
  const swipeRef = useRef<SwipeableCardHandle>(null);
  const articleRef = useRef<HTMLElement>(null);

  useImperativeHandle(ref, () => ({
    swipe: (direction) => swipeRef.current?.swipe(direction),
  }));

  async function handleSave() {
    onActed?.();
    const target = document.getElementById("shorts-read-later");
    const flight =
      articleRef.current && target
        ? flyBoomerang(articleRef.current, target)
        : Promise.resolve();
    const result = await saveToReadingList(article);
    await flight;
    onToast(result.message, !result.ok);
    if (result.ok) onSaved?.();
  }

  async function handleOmnivore() {
    onActed?.();
    const result = await sendToOmnivore(article);
    onToast(result.message, !result.ok);
  }

  return (
    <section
      data-index={index}
      className="flex h-full snap-start items-center justify-center px-4 py-20 md:px-8"
    >
      <SwipeableCard
        ref={swipeRef}
        onSwipeRight={handleSave}
        onSwipeLeft={handleOmnivore}
        rightLabel="Read later"
        leftLabel="To Omnivore"
        className="max-h-full w-full max-w-xl"
      >
        <article
          ref={articleRef}
          className="flex max-h-[calc(100dvh-10rem)] w-full flex-col overflow-hidden rounded-3xl border border-line bg-paper-raised shadow-[0_20px_60px_-30px_rgba(31,30,27,0.35)]"
        >
          <div className="relative shrink-0">
            {showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cachedImageUrl(article.image_url!)}
                alt=""
                decoding="async"
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
            {/* Who wrote it, when, and how long it is — on the picture rather
                than above the headline, which leaves the body to the two
                things you actually read. */}
            <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full bg-paper-raised/92 py-1.5 pr-3.5 pl-1.5 backdrop-blur">
              <FeedAvatar
                feedId={article.feed_id}
                title={article.feed_title}
                siteUrl={article.link}
                size={22}
              />
              <span className="truncate text-[12.5px] font-medium text-ink-soft">
                {article.feed_title}
              </span>
              {article.published_at && (
                <span className="shrink-0 text-[12.5px] text-ink-faint">
                  · {timeAgo(article.published_at)}
                </span>
              )}
              {article.reading_minutes ? (
                <span className="shrink-0 text-[12.5px] text-ink-faint">
                  · {article.reading_minutes} min
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-7 pb-4 md:p-8 md:pb-4">
            <h2 className="font-serif text-2xl leading-snug text-ink md:text-[28px] pointer-coarse:text-[34px]">
              {article.title}
            </h2>

            {article.summary && (
              <p className="line-clamp-6 text-[15px] leading-relaxed text-ink-soft pointer-coarse:text-[17px]">
                {article.summary}
              </p>
            )}

          </div>

          {/* Pinned, not the last thing in the scroller. A long summary used to
              push Read now and Save off the bottom of the card, which are the
              two things the deck exists for. */}
          <div className="flex shrink-0 flex-nowrap items-center gap-1.5 border-t border-line px-7 py-3.5 md:gap-2 md:px-8">
              <a
                href={unlockUrl(article.link)}
                target="_blank"
                rel="noopener noreferrer"
                title="Opens paywall-free via Marreta"
                onClick={() => {
                  recordEvent(article.link, "open");
                  onActed?.();
                }}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-clay px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-95 md:px-5 pointer-coarse:min-h-12 pointer-coarse:px-5 pointer-coarse:text-[15px]"
              >
                Read now
              </a>
              {/* Was an icon. Save is the action this deck exists for, and an
                  outline bookmark is not a word. */}
              <button
                onClick={() => swipeRef.current?.swipe("right")}
                title="Save to Read later"
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm text-ink-soft transition hover:border-clay hover:text-clay md:px-5 pointer-coarse:min-h-12 pointer-coarse:px-5 pointer-coarse:text-[15px]"
              >
                <BookmarkIcon size={15} /> Save
              </button>
              <span className="flex-1" />
              {/* Both stay icon-only, and both step aside on a touch screen:
                  a swipe left already sends to Omnivore, and the row has to
                  hold two 56px buttons there. */}
              <button
                onClick={() => swipeRef.current?.swipe("left")}
                title="Send to Omnivore"
                aria-label="Send to Omnivore"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line md:h-10 md:w-10 text-ink-soft transition hover:border-clay hover:text-clay pointer-coarse:hidden"
              >
                <OmnivoreIcon size={16} />
              </button>
              <a
                href={article.link}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the original"
                aria-label="Open the original"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line md:h-10 md:w-10 text-ink-soft transition hover:border-clay hover:text-clay pointer-coarse:hidden"
              >
                <ExternalIcon size={16} />
              </a>
          </div>
        </article>
      </SwipeableCard>
    </section>
  );
}
