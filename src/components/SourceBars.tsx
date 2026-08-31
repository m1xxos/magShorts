"use client";

import Link from "next/link";
import { feedTone, type StatsFeedDto } from "@/lib/types";

const SECTION_LABEL =
  "text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase";

// Which publications the reading actually came from, at the same tone the feed
// wears everywhere else — so the bar and the avatar in the rail are obviously
// the same publication.
export function SourceBars({ feeds }: { feeds: StatsFeedDto[] }) {
  const peak = Math.max(1, ...feeds.map((feed) => feed.count));

  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-5">
      <p className={`${SECTION_LABEL} mb-3.5`}>Where it comes from</p>
      {feeds.length === 0 ? (
        <p className="text-[13px] leading-normal text-ink-soft">
          Nothing read in this stretch.
        </p>
      ) : (
        <div className="flex flex-col gap-[11px]">
          {feeds.map((feed) => (
            <Link
              key={feed.feed_id}
              href={`/?feed=${feed.feed_id}`}
              className="group block"
            >
              <div className="mb-[5px] flex justify-between text-[13px] text-ink">
                <span className="truncate group-hover:text-clay">
                  {feed.title}
                </span>
                <span className="pl-2 tabular-nums text-ink-faint">
                  {feed.count}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-paper-sunken">
                <div
                  // The tone is per-feed and comes out of a function, so
                  // Tailwind cannot see it — the same reason the digest sets
                  // its publication colours inline.
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${(feed.count / peak) * 100}%`,
                    background: feedTone(feed.feed_id),
                  }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
