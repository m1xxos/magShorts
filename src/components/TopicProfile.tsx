"use client";

import { type StatsTopicDto } from "@/lib/types";

const SECTION_LABEL =
  "text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase";

// What "For you" learned, in words.
//
// The tags are read-only. They describe the profile; they do not edit it, and
// nothing here pretends otherwise — no menu, no hover affordance, no "tap to
// nudge" on a tag that does nothing when tapped.
export function TopicProfile({
  topics,
  signalCount,
}: {
  topics: StatsTopicDto[];
  signalCount: number;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-5">
      <p className={`${SECTION_LABEL} mb-3`}>What For you learned</p>
      {topics.length === 0 ? (
        <p className="text-[13px] leading-normal text-ink-soft">
          Not enough signal yet. A word has to turn up in a few different
          articles you opened before it means anything —{" "}
          {signalCount === 0
            ? "keep reading and this fills in."
            : `${signalCount} so far.`}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-[7px]">
            {topics.map((topic) => (
              <span
                key={topic.term}
                title={
                  topic.direction === "up"
                    ? "Turning up more often lately"
                    : topic.direction === "suppressed"
                      ? "Shows up more in what you skip than in what you read"
                      : undefined
                }
                className={`rounded-full px-[11px] py-[5px] text-xs ${
                  topic.direction === "up"
                    ? "bg-clay-soft text-clay"
                    : topic.direction === "suppressed"
                      ? "bg-paper-sunken text-ink-faint line-through"
                      : "bg-paper-sunken text-ink-soft"
                }`}
              >
                {topic.term}
                {topic.direction === "up" ? " ↑" : ""}
              </span>
            ))}
          </div>
          <p className="text-[13px] leading-normal text-ink-soft">
            Built from {signalCount} {signalCount === 1 ? "signal" : "signals"}.
            {topics.some((topic) => topic.direction === "suppressed")
              ? " Struck through means it shows up more in what you skip."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
