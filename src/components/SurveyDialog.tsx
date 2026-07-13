"use client";

import { type ReadingItemDto } from "@/lib/types";
import { ThumbsDownIcon, ThumbsUpIcon } from "./SwipeableCard";

export type SurveyChoice = "like" | "dislike" | "skip";

export function SurveyDialog({
  item,
  onChoose,
  onClose,
}: {
  item: ReadingItemDto;
  onChoose: (choice: SurveyChoice) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-paper-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-ink">Did you like it?</h2>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink-faint">
          {item.title}
        </p>
        <p className="mt-3 text-[13px] text-ink-soft">
          Your answer tunes the “For you” feed.
        </p>
        <div className="mt-5 space-y-2">
          <button
            onClick={() => onChoose("like")}
            className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-sm text-ink transition hover:border-clay hover:bg-clay-soft hover:text-clay"
          >
            <ThumbsUpIcon size={15} /> Liked it
          </button>
          <button
            onClick={() => onChoose("dislike")}
            className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-sm text-ink transition hover:border-ink hover:bg-paper-sunken"
          >
            <ThumbsDownIcon size={15} /> Not really
          </button>
          <button
            onClick={() => onChoose("skip")}
            className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-sm text-ink-soft transition hover:bg-paper-sunken"
          >
            <span className="inline-flex w-[15px] justify-center">–</span>
            Didn’t read it
          </button>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl px-4 py-2 text-sm text-ink-faint hover:bg-paper-sunken hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
