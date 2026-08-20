"use client";

import { type ReaderHeading } from "@/lib/types";

// The left rail: where you are in the article, and how much of it is left.
// Only drawn when the piece actually has sub-headings — most news stories
// don't, and an empty rail is worse than no rail.
export function ReaderOutline({
  headings,
  activeId,
  onJump,
}: {
  headings: ReaderHeading[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  if (headings.length === 0) return null;
  return (
    <>
      <p className="mb-3 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        In this article
      </p>
      <div className="flex flex-col gap-2.5 border-l border-line pl-3.5">
        {headings.map((heading) => (
          <button
            key={heading.id}
            onClick={() => onJump(heading.id)}
            className={`text-left text-[13px] leading-snug transition ${
              heading.id === activeId
                ? "font-medium text-ink"
                : "text-ink-faint hover:text-ink-soft"
            }`}
            // h3 and deeper step in, so the rail reads as the shape of the
            // article rather than a flat list.
            style={{ paddingLeft: `${(heading.level - 2) * 10}px` }}
          >
            {heading.text}
          </button>
        ))}
      </div>
    </>
  );
}
