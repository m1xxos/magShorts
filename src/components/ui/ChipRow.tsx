"use client";

import { type ReactNode } from "react";

// A row of chips that never becomes a horizontal scrollbar on the page.
//
// `wrap` on desktop, where there is room for two lines; a scrolling row on
// touch, where a wrapped row of topics pushes the list itself off the screen.
export function ChipRow({
  children,
  wrap = false,
  className = "",
}: {
  children: ReactNode;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`no-scrollbar flex gap-1.5 ${
        wrap ? "flex-wrap" : "overflow-x-auto"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  count,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] whitespace-nowrap transition pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-[14.5px] ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paper-raised text-ink-soft hover:border-clay hover:text-clay"
      }`}
    >
      {children}
      {count !== undefined && (
        <span
          className={`tabular-nums ${active ? "text-paper/60" : "text-ink-faint"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
