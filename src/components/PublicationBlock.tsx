"use client";

import { useState } from "react";
import {
  feedTone,
  timeAgo,
  type CatalogArticleDto,
  type CatalogPublicationDto,
} from "@/lib/types";
import { cachedImageUrl, recordEvent } from "@/lib/actions";

// One publication in the Discover catalog: who it is, then three of its
// articles, because a publication is best judged by what it actually
// publishes rather than by a description of itself.

// "4 posts / week" reads well for a magazine and absurdly for a blog that
// posts every few weeks, so the unit follows the cadence.
export function cadence(postsPerWeek: number | null): string | null {
  if (postsPerWeek === null || postsPerWeek <= 0) return null;
  if (postsPerWeek >= 1) {
    return `${Math.round(postsPerWeek)} posts / week`;
  }
  const perMonth = Math.round(postsPerWeek * 4.35);
  if (perMonth >= 1) return `${perMonth} posts / month`;
  return "a few posts a year";
}

function toneGradient(feedId: number): string {
  const tone = feedTone(feedId);
  return `linear-gradient(135deg, ${tone}18, ${tone}42)`;
}

// One article tile. The catalog keeps ten articles per publication and the
// block leads with three, so this is also what "read more" unfolds.
function ArticleTile({
  article,
  feedId,
}: {
  article: CatalogArticleDto;
  feedId: number;
}) {
  return (
    // Evidence about the publication, not a queue: these open, and
    // deliberately carry no save or skip affordance.
    <a
      // Straight to the publisher, not through Marreta: in Discover you are
      // judging an unfamiliar publication, and its own site — design, ads,
      // paywall and all — is the thing being judged.
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => recordEvent(article.link, "open", article.title)}
      className="group flex flex-col"
    >
      {article.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cachedImageUrl(article.image_url)}
          alt=""
          loading="lazy"
          className="aspect-video w-full rounded-xl object-cover"
        />
      ) : (
        <div
          className="aspect-video w-full rounded-xl"
          style={{ background: toneGradient(feedId) }}
        />
      )}
      <h3 className="mt-2.5 font-serif text-[17px] leading-[1.32] font-medium text-ink group-hover:text-clay">
        {article.title}
      </h3>
      <p className="mt-auto flex flex-wrap items-center gap-2 pt-2.5">
        {article.topic && (
          <span className="rounded-full bg-paper-sunken px-[9px] py-[3px] text-[11px] text-ink-soft">
            {article.topic}
          </span>
        )}
        <span className="text-[12px] text-ink-faint">
          {timeAgo(article.published_at)}
        </span>
      </p>
    </a>
  );
}

export function PublicationBlock({
  publication,
  onSubscribe,
  onDismiss,
}: {
  publication: CatalogPublicationDto;
  onSubscribe: (publication: CatalogPublicationDto) => void;
  onDismiss: (publication: CatalogPublicationDto) => void;
}) {
  const rate = cadence(publication.posts_per_week);
  // The rest of what the catalog holds for this publication, fetched only if
  // asked for: three tiles are the pitch, and most blocks are never opened.
  const [more, setMore] = useState<CatalogArticleDto[]>([]);
  const [loading, setLoading] = useState(false);

  async function showMore() {
    if (more.length > 0) {
      setMore([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/discover/articles?feed=${publication.id}&limit=50`,
      );
      const data = response.ok ? await response.json() : null;
      const shown = new Set(publication.articles.map((a) => a.id));
      setMore(
        ((data?.articles ?? []) as CatalogArticleDto[]).filter(
          (a) => !shown.has(a.id),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-line bg-paper-raised">
      <div className="flex items-start gap-3 border-b border-paper-sunken px-5 py-[18px]">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-serif text-[18px] text-white"
          style={{ backgroundColor: feedTone(publication.id) }}
        >
          {publication.title.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[18px] text-ink">{publication.title}</p>
          <p className="mt-0.5 text-[12.5px] leading-[1.45] text-ink-soft">
            {publication.description}
            {publication.description && rate ? " " : ""}
            {rate}
            {!publication.description && !rate && publication.site_url
              ? new URL(publication.site_url).hostname.replace(/^www\./, "")
              : ""}
          </p>
        </div>
        {publication.is_subscribed ? (
          <span className="shrink-0 rounded-full border border-line bg-paper px-[15px] py-[7px] text-[12.5px] text-ink-soft">
            Following
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => onSubscribe(publication)}
              className="rounded-full bg-clay px-[15px] py-[7px] text-[12.5px] font-medium text-white transition hover:brightness-95"
            >
              Subscribe
            </button>
            {/* The catalog proposes; this is how you answer it. Quiet enough
                not to compete with Subscribe, present enough to use. */}
            <button
              onClick={() => onDismiss(publication)}
              title="Not for me — remove from Discover"
              aria-label={`Remove ${publication.title} from Discover`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-paper-sunken hover:text-ink"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 px-5 py-[18px] sm:grid-cols-2 lg:grid-cols-3">
        {[...publication.articles, ...more].map((article) => (
          <ArticleTile
            key={article.id}
            article={article}
            feedId={publication.id}
          />
        ))}
      </div>

      {publication.article_count > publication.articles.length && (
        <div className="border-t border-paper-sunken px-5 py-3">
          <button
            onClick={showMore}
            disabled={loading}
            className="text-[12.5px] text-clay transition hover:brightness-90 disabled:text-ink-faint"
          >
            {loading
              ? "Loading…"
              : more.length > 0
                ? "Show less"
                : `Read more from ${publication.title} (${publication.article_count - publication.articles.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
