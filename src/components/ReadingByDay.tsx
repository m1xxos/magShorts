"use client";

import { useEffect, useRef, useState } from "react";
import { type StatsBucketDto } from "@/lib/types";

const SECTION_LABEL =
  "text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase";

function minutes(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}`;
}

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
  // The bar being pointed at. Not the native `title` this started as: that
  // waits a second before it appears, cannot hold two lines, and looks like
  // the operating system rather than like this page.
  const [active, setActive] = useState<number | null>(null);
  const chart = useRef<HTMLDivElement>(null);

  // A finger has no "leave": the pointer stops existing when it lifts, and
  // pointerleave fires straight after pointerdown, so a tap would show the
  // tooltip and take it away in the same frame. On touch the next tap
  // somewhere else is what puts it away.
  useEffect(() => {
    if (active === null) return;
    const dismiss = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (!chart.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [active]);

  const peak = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const last = buckets.length - 1;
  const midpoint = buckets[Math.floor(last / 2)];
  // A month bucket is keyed YYYY-MM, a day one YYYY-MM-DD. The heading and the
  // right-hand axis label are the two places the difference shows.
  const monthly = buckets[0]?.key.length === 7;
  const shown =
    active === null ? null : { index: active, ...buckets[active] };

  return (
    <div className="min-w-0 flex-[1.5] rounded-[14px] border border-line bg-paper-raised p-[22px]">
      <p className={`${SECTION_LABEL} mb-[18px]`}>
        Reading by {monthly ? "month" : "day"}
      </p>
      <div
        ref={chart}
        className="relative"
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setActive(null);
        }}
        // What the chart says to anyone who cannot point at it. The generated
        // sentence below carries the reading of it.
        role="img"
        aria-label={`Articles read per ${monthly ? "month" : "day"}, ${buckets[0]?.label} to ${buckets[last]?.label}. ${note}`}
      >
        {shown && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-line bg-paper-raised px-3 py-2 shadow-[0_14px_40px_-16px_rgba(31,30,27,0.45)]"
            // Inside the chart's own headroom rather than above it: anchored
            // to the top of the card it would hang over the edge, which reads
            // as a bug rather than as a tooltip. Centred on its own bar, then
            // held inside the card at either end so the first and last
            // buckets are readable rather than clipped.
            style={{
              left: `${Math.min(88, Math.max(12, ((shown.index + 0.5) / buckets.length) * 100))}%`,
            }}
          >
            <p className="text-[13px] whitespace-nowrap text-ink">
              {shown.label}
            </p>
            <p className="mt-0.5 text-xs whitespace-nowrap text-ink-faint">
              {shown.count === 0
                ? "nothing read"
                : `${shown.count} ${shown.count === 1 ? "article" : "articles"}${
                    shown.seconds > 0 ? ` · ${minutes(shown.seconds)}` : ""
                  }`}
            </p>
          </div>
        )}
        <div className="flex h-[132px] items-end gap-1.5">
          {buckets.map((bucket, index) => (
            <div
              key={bucket.key}
              // The whole column is the target, not the bar: a day with
              // nothing read is two pixels tall and would otherwise be
              // impossible to ask about. Pointer events rather than mouse
              // ones, so a tap answers on a screen that cannot hover.
              onPointerEnter={() => setActive(index)}
              // Not a toggle: on a touch screen pointerenter fires first and
              // a toggle here would close what that just opened.
              onPointerDown={() => setActive(index)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className={`w-full rounded-t transition-colors ${
                  bucket.count === 0
                    ? "bg-line"
                    : index === last || active === index
                      ? "bg-clay"
                      : "bg-paper-sunken"
                }`}
                // Linear against the peak, because a log scale would flatter a
                // quiet fortnight. But a day with one article gets a floor of
                // its own: without it, one catch-up session of fifty makes
                // every ordinary day the same 2px sliver as a day with nothing
                // at all, and the chart stops answering the question it was
                // drawn for.
                style={{
                  height:
                    bucket.count === 0
                      ? "2px"
                      : `${Math.max(7, (bucket.count / peak) * 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
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
