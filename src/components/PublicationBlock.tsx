"use client";

import { feedTone, timeAgo, type CatalogPublicationDto } from "@/lib/types";
import { cachedImageUrl, recordEvent, unlockUrl } from "@/lib/actions";

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

export function PublicationBlock({
  publication,
  onSubscribe,
}: {
  publication: CatalogPublicationDto;
  onSubscribe: (publication: CatalogPublicationDto) => void;
}) {
  const rate = cadence(publication.posts_per_week);

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
          <button
            onClick={() => onSubscribe(publication)}
            className="shrink-0 rounded-full bg-clay px-[15px] py-[7px] text-[12.5px] font-medium text-white transition hover:brightness-95"
          >
            Subscribe
          </button>
        )}
      </div>

      <div className="grid gap-5 px-5 py-[18px] sm:grid-cols-2 lg:grid-cols-3">
        {publication.articles.map((article) => (
          // Evidence about the publication, not a queue: these open, and
          // deliberately carry no save or skip affordance.
          <a
            key={article.id}
            href={unlockUrl(article.link)}
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
                style={{ background: toneGradient(publication.id) }}
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
        ))}
      </div>
    </div>
  );
}
