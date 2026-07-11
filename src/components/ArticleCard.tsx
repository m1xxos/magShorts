"use client";

import { useRef, useState } from "react";
import { type ArticleDto, feedTone, timeAgo } from "@/lib/types";
import { saveToReadingList, sendToOmnivore, unlockUrl } from "@/lib/actions";
import { FeedAvatar } from "./FeedAvatar";
import {
  BookmarkIcon,
  ExternalIcon,
  OmnivoreIcon,
  SwipeableCard,
  type SwipeableCardHandle,
} from "./SwipeableCard";

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper-raised/95 text-ink-soft shadow-sm backdrop-blur transition hover:text-clay"
    >
      {children}
    </button>
  );
}

export function ArticleCard({
  article,
  onToast,
}: {
  article: ArticleDto;
  onToast: (message: string, error?: boolean) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image_url && !imageFailed;
  const swipeRef = useRef<SwipeableCardHandle>(null);

  async function handleSave() {
    const result = await saveToReadingList(article);
    onToast(result.message, !result.ok);
  }

  async function handleOmnivore() {
    const result = await sendToOmnivore(article);
    onToast(result.message, !result.ok);
  }

  function swipeSave() {
    swipeRef.current?.swipe("right");
  }

  function swipeOmnivore() {
    swipeRef.current?.swipe("left");
  }

  return (
    <SwipeableCard
      ref={swipeRef}
      onSwipeRight={handleSave}
      onSwipeLeft={handleOmnivore}
      rightLabel="Read later"
      leftLabel="To Omnivore"
      className="h-full"
    >
      <a
        href={unlockUrl(article.link)}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.25)]"
      >
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-paper-sunken">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.image_url!}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${feedTone(article.feed_id)}22, ${feedTone(article.feed_id)}55)`,
              }}
            >
              <span
                className="font-serif text-6xl opacity-40"
                style={{ color: feedTone(article.feed_id) }}
              >
                {article.feed_title.charAt(0)}
              </span>
            </div>
          )}
          <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
            <ActionButton label="Read later" onClick={swipeSave}>
              <BookmarkIcon size={14} />
            </ActionButton>
            <ActionButton label="Send to Omnivore" onClick={swipeOmnivore}>
              <OmnivoreIcon size={14} />
            </ActionButton>
            <ActionButton
              label="Open the original"
              onClick={() => window.open(article.link, "_blank")}
            >
              <ExternalIcon size={14} />
            </ActionButton>
          </div>
        </div>
        <div className="flex flex-1 gap-3 p-4">
          <FeedAvatar
            feedId={article.feed_id}
            title={article.feed_title}
            siteUrl={article.link}
            size={32}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 className="line-clamp-3 min-h-[4.05em] font-serif text-[15px] leading-[1.35] font-medium text-ink">
              {article.title}
            </h3>
            <p className="mt-1.5 line-clamp-2 min-h-[2.7em] text-[13px] leading-[1.35] text-ink-soft">
              {article.summary ?? ""}
            </p>
            <p className="mt-auto pt-1.5 text-[13px] text-ink-faint">
              {article.feed_title}
              {article.published_at && (
                <>
                  <span className="mx-1.5">·</span>
                  {timeAgo(article.published_at)}
                </>
              )}
            </p>
          </div>
        </div>
      </a>
    </SwipeableCard>
  );
}
