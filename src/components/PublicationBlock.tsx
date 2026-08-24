"use client";

import { useState } from "react";
import {
  feedTone,
  timeAgo,
  type CatalogArticleDto,
  type CatalogPublicationDto,
} from "@/lib/types";
import { cachedImageUrl, recordEvent } from "@/lib/actions";
import { BookmarkIcon } from "./SwipeableCard";

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

// One article, as a row rather than a card.
//
// Three 16:9 covers per block meant two publications filled a viewport, and
// this page exists to compare publications, not to read the articles. A
// thumbnail row puts four or five of them in the same space, which is what
// makes a block evidence about a publication rather than a sample of one.
function ArticleRow({
  article,
  feedId,
  onSave,
  saved,
}: {
  article: CatalogArticleDto;
  feedId: number;
  onSave: (article: CatalogArticleDto) => void;
  saved: boolean;
}) {
  return (
    <li className="flex items-center gap-3.5">
      <a
        // Straight to the publisher, not through Marreta: in Discover you are
        // judging an unfamiliar publication, and its own site — design, ads,
        // paywall and all — is the thing being judged.
        href={article.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => recordEvent(article.link, "open", article.title)}
        className="group flex min-w-0 flex-1 items-center gap-3.5"
      >
        {article.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cachedImageUrl(article.image_url)}
            alt=""
            loading="lazy"
            width={84}
            height={56}
            className="h-[56px] w-[84px] shrink-0 rounded-lg object-cover pointer-coarse:h-[62px] pointer-coarse:w-[94px]"
          />
        ) : (
          <div
            className="h-[56px] w-[84px] shrink-0 rounded-lg pointer-coarse:h-[62px] pointer-coarse:w-[94px]"
            style={{ background: toneGradient(feedId) }}
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-serif text-[15.5px] leading-[1.32] font-medium text-ink group-hover:text-clay pointer-coarse:text-[16.5px]">
            {article.title}
          </h3>
          <p className="mt-1 text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
            {timeAgo(article.published_at)}
            {article.reading_minutes ? (
              <>
                <span className="mx-1.5">·</span>
                {article.reading_minutes} min
              </>
            ) : null}
            {article.topic ? (
              <>
                <span className="mx-1.5">·</span>
                {article.topic}
              </>
            ) : null}
          </p>
        </div>
      </a>

      {/* Outside the anchor: a button nested in a link is neither valid nor
          clickable. */}
      <button
        onClick={() => onSave(article)}
        title={saved ? "Remove from Read later" : "Save to Read later"}
        aria-label={
          saved
            ? `Remove ${article.title} from Read later`
            : `Save ${article.title} to Read later`
        }
        aria-pressed={saved}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition pointer-coarse:h-11 pointer-coarse:w-11 ${
          saved ? "text-ink" : "text-ink-faint hover:bg-paper-sunken hover:text-clay"
        }`}
      >
        <BookmarkIcon size={14} filled={saved} />
      </button>
    </li>
  );
}

export function PublicationBlock({
  publication,
  onSubscribe,
  onDismiss,
  onUndo,
  onSave,
  savedLinks,
}: {
  publication: CatalogPublicationDto;
  onSubscribe: (publication: CatalogPublicationDto) => void;
  onDismiss: (publication: CatalogPublicationDto) => void;
  onUndo?: (publication: CatalogPublicationDto) => void;
  onSave: (article: CatalogArticleDto) => void;
  // Links already in Read later. Kept by link rather than by article id, since
  // that is what Read later itself stores and what survives the catalog
  // trimming an article away.
  savedLinks: Set<string>;
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
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="font-serif text-[18px] text-ink">{publication.title}</p>
            {/* What it files under and how often it posts, up beside the name:
                both are already on the DTO, and both are what you weigh before
                reading a word of it. */}
            {publication.topics[0] && (
              <span className="rounded-full bg-paper-sunken px-[9px] py-[3px] text-[11px] text-ink-soft">
                {publication.topics[0]}
              </span>
            )}
            {rate && (
              <span className="text-[12px] text-ink-faint">{rate}</span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-[1.45] text-ink-soft pointer-coarse:text-[13.5px]">
            {publication.description ||
              (publication.site_url
                ? new URL(publication.site_url).hostname.replace(/^www\./, "")
                : "")}
          </p>
        </div>
        {publication.is_subscribed ? (
          // The row does not leave until the next load, so it says what
          // happened and offers the way back rather than sitting there as a
          // dead label.
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-line bg-paper px-[15px] py-[7px] text-[12.5px] text-ink-soft pointer-coarse:min-h-11">
              ✓ Following
            </span>
            {onUndo && (
              <button
                onClick={() => onUndo(publication)}
                className="text-[12.5px] text-clay transition hover:brightness-90 pointer-coarse:min-h-11 pointer-coarse:px-2"
              >
                Undo
              </button>
            )}
          </div>
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
              title="Never show this publication again"
              className="rounded-full border border-line px-[13px] py-[7px] text-[12.5px] text-ink-faint transition hover:border-clay hover:text-clay pointer-coarse:min-h-11"
            >
              Not for me
            </button>
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-3.5 px-5 py-[18px]">
        {[...publication.articles, ...more].map((article) => (
          <ArticleRow
            key={article.id}
            article={article}
            feedId={publication.id}
            onSave={onSave}
            saved={savedLinks.has(article.link)}
          />
        ))}
      </ul>

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
