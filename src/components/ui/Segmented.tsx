"use client";

import { type ReactNode } from "react";

// The pill group, written once.
//
// The same markup existed five times — three of them inside the reader's own Aa
// panel — and they had drifted: different paddings, different active colors,
// and only some of them said `aria-pressed`.

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "ink",
  size = "sm",
  className = "",
  ariaLabel,
}: {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  // `clay` where the choice is a property of the thing on the row (how a
  // publication opens); `ink` where it is a view the reader is picking.
  tone?: "ink" | "clay";
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const active =
    tone === "clay" ? "bg-clay text-white" : "bg-ink text-paper";
  const pad =
    size === "md"
      ? "px-3.5 py-2 text-[13.5px] pointer-coarse:min-h-13 pointer-coarse:text-[15.5px]"
      : "px-2.5 py-1 text-[12px] pointer-coarse:min-h-11 pointer-coarse:px-3.5 pointer-coarse:text-[14px]";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex shrink-0 rounded-full border border-line p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          title={option.title}
          className={`flex-1 rounded-full whitespace-nowrap transition ${pad} ${
            option.value === value
              ? active
              : "text-ink-faint hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
