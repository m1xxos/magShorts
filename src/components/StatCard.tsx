"use client";

import { type ReactNode } from "react";

// One headline number and what it means.
//
// The tone colours the note, never the figure: the figure is the fact and the
// note is the reading of it. And the note always says in words what the colour
// says, so nobody has to see the difference between sage and clay to know
// whether a number moved the right way.
export function StatCard({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note: string;
  tone?: "good" | "attention" | "neutral";
}) {
  const noteColor =
    tone === "good"
      ? "text-sage"
      : tone === "attention"
        ? "text-clay"
        : "text-ink-faint";

  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-[18px]">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-2 font-serif text-[32px] leading-none text-ink tabular-nums">
        {value}
      </p>
      <p className={`mt-1 text-xs ${noteColor}`}>{note}</p>
    </div>
  );
}
