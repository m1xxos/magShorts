"use client";

import { useState } from "react";
import { type ArticleDto, feedTone, timeAgo } from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";

export function ArticleCard({ article }: { article: ArticleDto }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = article.image_url && !imageFailed;

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.25)]"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-paper-sunken">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.image_url!}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${feedTone(article.feed_id)}22, ${feedTone(article.feed_id)}55)`,
            }}
          >
            <span
              className="font-serif text-6xl opacity-40"
              style={{ color: feedTone(article.feed_id) }}
            >
              {article.feed_title.charAt(0)}
            </span>
          </div>
        )}
      </div>
      <div className="flex gap-3 p-4">
        <FeedAvatar
          feedId={article.feed_id}
          title={article.feed_title}
          siteUrl={article.link}
          size={32}
        />
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-serif text-[15px] leading-snug font-medium text-ink">
            {article.title}
          </h3>
          <p className="mt-1.5 text-[13px] text-ink-faint">
            {article.feed_title}
            {article.published_at && (
              <>
                <span className="mx-1.5">·</span>
                {timeAgo(article.published_at)}
              </>
            )}
          </p>
        </div>
      </div>
    </a>
  );
}
