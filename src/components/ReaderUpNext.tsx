"use client";

import { cachedImageUrl } from "@/lib/actions";
import { feedTone, type ArticleDto } from "@/lib/types";

// The right rail. The point of the whole reader is that finishing an article
// doesn't end the session, so what comes next has to be visible before the
// reader is closed — and these are the next items from the list it was opened
// from, not a fresh recommendation.
export function ReaderUpNext({
  items,
  onOpen,
}: {
  items: ArticleDto[];
  onOpen: (article: ArticleDto) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <p className="mb-3 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        Up next
      </p>
      <div className="flex flex-col gap-3">
        {items.map((article) => (
          <button
            key={article.id}
            onClick={() => onOpen(article)}
            className="rounded-xl border border-line bg-paper p-3 text-left transition hover:border-clay"
          >
            {article.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cachedImageUrl(article.image_url)}
                alt=""
                loading="lazy"
                className="mb-2.5 h-14 w-full rounded-lg object-cover"
              />
            ) : (
              <div
                className="mb-2.5 h-14 w-full rounded-lg"
                style={{
                  background: `linear-gradient(135deg, ${feedTone(article.feed_id)}20, ${feedTone(article.feed_id)}50)`,
                }}
              />
            )}
            <p className="font-serif text-[14px] leading-[1.3] text-ink">
              {article.title}
            </p>
            <p className="mt-1.5 text-[12px] text-ink-faint">
              {article.feed_title}
            </p>
          </button>
        ))}
      </div>
    </>
  );
}
