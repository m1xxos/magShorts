"use client";

import { useState } from "react";
import { type ArticleDto, feedTone, timeAgo } from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";

export function ShortCard({
  article,
  index,
}: {
  article: ArticleDto;
  index: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image_url && !imageFailed;
  const tone = feedTone(article.feed_id);

  return (
    <section
      data-index={index}
      className="flex h-full snap-start items-center justify-center px-4 py-20 md:px-8"
    >
      <article className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-line bg-paper-raised shadow-[0_20px_60px_-30px_rgba(31,30,27,0.35)]">
        <div className="relative shrink-0">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.image_url!}
              alt=""
              onError={() => setImageFailed(true)}
              className="h-52 w-full object-cover md:h-64"
            />
          ) : (
            <div
              className="flex h-36 w-full items-center justify-center md:h-44"
              style={{
                background: `linear-gradient(135deg, ${tone}1d, ${tone}4d)`,
              }}
            >
              <span className="font-serif text-7xl opacity-35" style={{ color: tone }}>
                {article.feed_title.charAt(0)}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-7 md:p-8">
          <div className="flex items-center gap-2.5">
            <FeedAvatar feedId={article.feed_id} title={article.feed_title} size={26} />
            <span className="text-[13px] font-medium text-ink-soft">
              {article.feed_title}
            </span>
            {article.published_at && (
              <span className="text-[13px] text-ink-faint">
                · {timeAgo(article.published_at)}
              </span>
            )}
          </div>

          <h2 className="font-serif text-2xl leading-snug text-ink md:text-[28px]">
            {article.title}
          </h2>

          {article.summary && (
            <p className="text-[15px] leading-relaxed text-ink-soft">
              {article.summary}
            </p>
          )}

          <div className="mt-auto pt-2">
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-clay px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-95"
            >
              Read the article →
            </a>
          </div>
        </div>
      </article>
    </section>
  );
}
