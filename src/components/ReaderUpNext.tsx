"use client";

import { cachedImageUrl } from "@/lib/actions";
import { feedTone, type ArticleDto } from "@/lib/types";

// What to read after this one. The point of the whole reader is that finishing
// an article doesn't end the session, so what comes next has to be visible
// before the reader is closed.
//
// Two layouts, because it appears in two shapes of hole. In the 212px rail a
// card stacks its picture over its headline; under the article there is the
// full column, and stacking there gives four cards a screen of their own with
// a 700px-wide thumbnail on top of each. That version is a grid of rows.
export function ReaderUpNext({
  items,
  onOpen,
  layout = "rail",
}: {
  items: ArticleDto[];
  onOpen: (article: ArticleDto) => void;
  layout?: "rail" | "grid";
}) {
  if (items.length === 0) return null;
  const grid = layout === "grid";
  return (
    <>
      <p className="mb-3 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        Up next
      </p>
      <div
        className={
          grid ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-3"
        }
      >
        {items.map((article) => (
          <button
            key={article.id}
            onClick={() => onOpen(article)}
            className={`rounded-xl border border-line bg-paper p-3 text-left transition hover:border-clay ${
              grid ? "flex items-center gap-3" : ""
            }`}
          >
            {article.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cachedImageUrl(article.image_url)}
                alt=""
                loading="lazy"
                width={grid ? 76 : undefined}
                height={grid ? 56 : undefined}
                className={
                  grid
                    ? "h-14 w-[76px] shrink-0 rounded-lg object-cover"
                    : "mb-2.5 h-14 w-full rounded-lg object-cover"
                }
              />
            ) : (
              <div
                className={
                  grid
                    ? "h-14 w-[76px] shrink-0 rounded-lg"
                    : "mb-2.5 h-14 w-full rounded-lg"
                }
                style={{
                  background: `linear-gradient(135deg, ${feedTone(article.feed_id)}20, ${feedTone(article.feed_id)}50)`,
                }}
              />
            )}
            <span className={grid ? "min-w-0 flex-1" : undefined}>
              <p
                className={`font-serif leading-[1.3] text-ink ${
                  grid ? "line-clamp-2 text-[15px]" : "text-[14px]"
                }`}
              >
                {article.title}
              </p>
              <p className="mt-1.5 truncate text-[12px] text-ink-faint">
                {article.feed_title}
              </p>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
