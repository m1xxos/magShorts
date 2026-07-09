"use client";

import { type FeedDto } from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";

export function Sidebar({
  feeds,
  selectedFeedId,
  onSelect,
  onRemove,
  onAddClick,
}: {
  feeds: FeedDto[];
  selectedFeedId: number | null;
  onSelect: (feedId: number | null) => void;
  onRemove: (feed: FeedDto) => void;
  onAddClick: () => void;
}) {
  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col gap-1 overflow-y-auto px-3 py-5 md:flex">
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
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
    </aside>
  );
}
