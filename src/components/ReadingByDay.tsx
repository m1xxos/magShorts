"use client";

import { type StatsBucketDto } from "@/lib/types";

const SECTION_LABEL =
  "text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase";

// Fourteen to thirty divs with percentage heights. A charting library would be
// three hundred kilobytes to draw a bar, and it would arrive with its own idea
// of what colours are.
export function ReadingByDay({
  buckets,
  note,
}: {
  buckets: StatsBucketDto[];
  note: string;
}) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const last = buckets.length - 1;
  const midpoint = buckets[Math.floor(last / 2)];
  // A month bucket is keyed YYYY-MM, a day one YYYY-MM-DD. The heading and the
  // right-hand axis label are the two places the difference shows.
  const monthly = buckets[0]?.key.length === 7;

  return (
    <div className="min-w-0 flex-[1.5] rounded-[14px] border border-line bg-paper-raised p-[22px]">
      <p className={`${SECTION_LABEL} mb-[18px]`}>
        Reading by {monthly ? "month" : "day"}
      </p>
      <div className="flex h-[132px] items-end gap-1.5">
        {buckets.map((bucket, index) => (
          <div
            key={bucket.key}
            // The native title is the whole tooltip story here. The app has
            // never had one and a chart is a poor reason to build the first.
            title={`${bucket.label}: ${bucket.count} ${
              bucket.count === 1 ? "article" : "articles"
            }`}
            className={`flex-1 rounded-t ${
              bucket.count === 0
                ? "bg-line"
                : index === last
                  ? "bg-clay"
                  : "bg-paper-sunken"
            }`}
            // Linear against the peak, because a log scale would flatter a
            // quiet fortnight. But a day with one article gets a floor of its
            // own: without it, one catch-up session of fifty makes every
            // ordinary day the same 2px sliver as a day with nothing at all,
            // and the chart stops answering the question it was drawn for.
            style={{
              height:
                bucket.count === 0
                  ? "2px"
                  : `${Math.max(7, (bucket.count / peak) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex justify-between text-[11.5px] text-ink-faint">
        <span>{buckets[0]?.label}</span>
        <span>{midpoint?.label}</span>
        <span>{monthly ? "This month" : "Today"}</span>
      </div>
      <p className="mt-[18px] text-[13px] leading-normal text-ink-soft">{note}</p>
    </div>
  );
}
