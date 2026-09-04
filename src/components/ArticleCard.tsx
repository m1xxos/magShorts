"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { type ArticleDto, type Density, feedTone, timeAgo } from "@/lib/types";
import {
  cachedImageUrl,
  recordEvent,
  saveToReadingList,
  unlockUrl,
} from "@/lib/actions";
import { readerLink } from "@/lib/useReader";
import { FeedAvatar } from "./FeedAvatar";
import {
  BookmarkIcon,
  ExternalIcon,
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

// The tag, and the way to see everything else carrying it. A button rather
// than a link because the whole card is already an anchor, and an anchor
// inside an anchor is not a thing — the same reason the save and open buttons
// above are buttons.
function TopicPill({ topic }: { topic: string }) {
  const router = useRouter();
  return (
    <button
      title={`Everything tagged ${topic}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        router.push(`/search?q=${encodeURIComponent(`tag:${topic}`)}`);
      }}
      className="shrink-0 rounded-full bg-paper-sunken px-[9px] py-[3px] text-[11px] text-ink-soft transition hover:bg-clay-soft hover:text-clay"
    >
      {topic}
    </button>
  );
}

function Source({
  article,
  className,
}: {
  article: ArticleDto;
  className: string;
}) {
  return (
    <span className={className}>
      {article.feed_title}
      {article.published_at && (
        <>
          <span className="mx-1.5">·</span>
          {timeAgo(article.published_at)}
        </>
      )}
    </span>
  );
}

export function ArticleCard({
  article,
  density = "cards",
  onToast,
  onOpen,
}: {
  article: ArticleDto;
  density?: Density;
  onToast: (message: string, error?: boolean) => void;
  // Present on the pages that host the reader. Without it the card keeps its
  // original behaviour — the unlock route in a new tab — which is what Shorts,
  // the digest and Discover still want.
  onOpen?: (article: ArticleDto) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image_url && !imageFailed;
  const swipeRef = useRef<SwipeableCardHandle>(null);
  const tone = feedTone(article.feed_id);

  async function handleSave() {
    const result = await saveToReadingList(article);
    onToast(result.message, !result.ok);
  }


  function swipeSave() {
    swipeRef.current?.swipe();
  }


  // Cover art, or a typographic stand-in built from the feed's tone when the
  // article has no image at all. `titleClass` lets the list thumbnail carry a
  // smaller headline than the full-width card cover.
  function cover(titleClass: string) {
    if (showImage) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cachedImageUrl(article.image_url!)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      );
    }
    return (
      <div
        className="flex h-full w-full flex-col justify-end p-4"
        style={{ background: `linear-gradient(135deg, ${tone}18, ${tone}42)` }}
      >
        <span
          className="mb-2 h-1 w-8 rounded-full"
          style={{ backgroundColor: tone }}
        />
        <span className={titleClass}>{article.title}</span>
      </div>
    );
  }

  function actions(className: string) {
    return (
      <div className={className}>
        <ActionButton label="Read later" onClick={swipeSave}>
          <BookmarkIcon size={14} />
        </ActionButton>
        <ActionButton
          label="Open the original"
          onClick={() => window.open(article.link, "_blank")}
        >
          <ExternalIcon size={14} />
        </ActionButton>
      </div>
    );
  }

  const linkProps = onOpen
    ? readerLink(article, onOpen)
    : {
        href: unlockUrl(article.link),
        target: "_blank",
        rel: "noopener noreferrer",
        onClick: () => recordEvent(article.link, "open"),
      };
  const overlayActions =
    "absolute top-2 right-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100 pointer-coarse:opacity-100";

  return (
    <SwipeableCard
      ref={swipeRef}
      onSwipeRight={handleSave}
      rightLabel="Read later"
      radiusClass={density === "compact" ? "rounded-xl" : "rounded-2xl"}
      className="h-full"
    >
      {density === "cards" ? (
        <a
          {...linkProps}
          className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.25)]"
        >
          <div className="relative aspect-[2/1] w-full shrink-0 overflow-hidden bg-paper-sunken">
            {cover(
              "line-clamp-3 font-serif text-[19px] leading-snug text-ink"
            )}
            {actions(overlayActions)}
          </div>
          <div className="flex flex-1 gap-3 p-4">
            <FeedAvatar
              feedId={article.feed_id}
              title={article.feed_title}
              siteUrl={article.link}
              size={32}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Headlines stay unclamped — a taller card just grows its grid
                  row, and `mt-auto` keeps every metadata row on one line. */}
              <h3 className="font-serif text-[16px] leading-[1.35] font-medium text-ink">
                {article.title}
              </h3>
              {article.summary && (
                <p className="mt-2 line-clamp-3 text-[13px] leading-[1.5] text-ink-soft">
                  {article.summary}
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                {article.topic && <TopicPill topic={article.topic} />}
                <Source article={article} className="text-[13px] text-ink-faint" />
              </div>
            </div>
          </div>
        </a>
      ) : density === "list" ? (
        <a
          {...linkProps}
          className="group flex gap-4 overflow-hidden rounded-2xl border border-line bg-paper-raised p-3 transition duration-200 hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.25)]"
        >
          <div className="relative aspect-[4/3] w-[104px] shrink-0 overflow-hidden rounded-[10px] bg-paper-sunken sm:w-[140px]">
            {cover("line-clamp-2 font-serif text-[13px] leading-snug text-ink")}
            {actions(
              "absolute top-1.5 right-1.5 flex gap-1.5 opacity-0 transition group-hover:opacity-100 pointer-coarse:opacity-100"
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col py-0.5">
            <div className="flex flex-wrap items-center gap-2">
              {article.topic && <TopicPill topic={article.topic} />}
              <Source article={article} className="text-[12px] text-ink-faint" />
            </div>
            <h3 className="mt-1.5 font-serif text-[17px] leading-[1.35] font-medium text-ink">
              {article.title}
            </h3>
            {article.summary && (
              <p className="mt-1.5 line-clamp-3 text-[13px] leading-[1.5] text-ink-soft">
                {article.summary}
              </p>
            )}
          </div>
        </a>
      ) : (
        <a
          {...linkProps}
          className="group flex min-h-14 items-center gap-3 rounded-xl border border-line bg-paper-raised px-4 transition duration-200 hover:border-clay"
        >
          <FeedAvatar
            feedId={article.feed_id}
            title={article.feed_title}
            siteUrl={article.link}
            size={24}
          />
          <h3 className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium text-ink transition group-hover:text-clay">
            {article.title}
          </h3>
          {article.topic && (
            <span className="hidden sm:block">
              <TopicPill topic={article.topic} />
            </span>
          )}
          <span className="hidden shrink-0 sm:block">
            <Source article={article} className="text-[12px] text-ink-faint" />
          </span>
          {actions(
            "flex shrink-0 gap-1.5 opacity-0 transition group-hover:opacity-100 pointer-coarse:opacity-100"
          )}
        </a>
      )}
    </SwipeableCard>
  );
}
