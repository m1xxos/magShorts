"use client";

import Link from "next/link";
import { type FeedDto } from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";
import { BookmarkIcon } from "./SwipeableCard";

export function Sidebar({
  feeds,
  selectedFeedId,
  readingCount,
  onSelect,
  onRemove,
  onToggle,
  onAddClick,
  onOpenSettings,
}: {
  feeds: FeedDto[];
  selectedFeedId: number | null;
  readingCount: number;
  onSelect: (feedId: number | null) => void;
  onRemove: (feed: FeedDto) => void;
  onToggle: (feed: FeedDto) => void;
  onAddClick: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col gap-1 overflow-y-auto px-3 py-5 md:flex">
      <Link
        href="/reading-list"
        className="mb-4 flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-soft transition hover:bg-paper-sunken/60"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-clay-soft text-clay">
          <BookmarkIcon size={14} />
        </span>
        Read later
        {readingCount > 0 && (
          <span className="ml-auto rounded-full bg-paper-sunken px-2 py-0.5 text-[12px] tabular-nums text-ink-faint">
            {readingCount}
          </span>
        )}
      </Link>

      <p className="px-3 pb-2 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        Subscriptions
      </p>

      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
          selectedFeedId === null
            ? "bg-paper-sunken font-medium text-ink"
            : "text-ink-soft hover:bg-paper-sunken/60"
        }`}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-soft">
          ∗
        </span>
        All publications
      </button>

      {feeds.map((feed) => (
        <div
          key={feed.id}
          className={`group flex items-center gap-3 rounded-xl px-3 py-2 transition ${
            selectedFeedId === feed.id
              ? "bg-paper-sunken"
              : "hover:bg-paper-sunken/60"
          }`}
        >
          <button
            onClick={() => onSelect(feed.id)}
            className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
              feed.enabled ? "" : "opacity-40 grayscale"
            }`}
          >
            <FeedAvatar
              feedId={feed.id}
              title={feed.title}
              siteUrl={feed.site_url ?? feed.url}
            />
            <span
              className={`truncate text-sm ${
                selectedFeedId === feed.id
                  ? "font-medium text-ink"
                  : "text-ink-soft"
              }`}
            >
              {feed.title}
            </span>
          </button>
          <button
            role="switch"
            aria-checked={Boolean(feed.enabled)}
            title={feed.enabled ? "Turn off this feed" : "Turn on this feed"}
            onClick={() => onToggle(feed)}
            className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
              feed.enabled ? "bg-clay" : "bg-line"
            }`}
          >
            <span
              className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
                feed.enabled ? "left-[16px]" : "left-[2px]"
              }`}
            />
          </button>
          <button
            title={`Unsubscribe from ${feed.title}`}
            onClick={() => onRemove(feed)}
            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-line hover:text-ink group-hover:inline-flex"
          >
            ×
          </button>
        </div>
      ))}

      <button
        onClick={onAddClick}
        className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-left text-sm text-ink-soft transition hover:border-clay hover:text-clay"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-clay-soft text-clay">
          +
        </span>
        Add publication
      </button>

      <button
        onClick={onOpenSettings}
        className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2 pt-4 text-left text-sm text-ink-faint transition hover:text-ink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Settings
      </button>
    </aside>
  );
}
