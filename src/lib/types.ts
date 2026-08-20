export type Selection =
  | { kind: "forYou" }
  | { kind: "all" }
  | { kind: "feed"; feedId: number }
  | { kind: "folder"; folderId: number };

export type RecWindow = "day" | "week" | "month";

// Shape of /api/settings. The dialog edits only some of these; the per-domain
// lists are written from Manage sources.
export interface SettingsForm {
  omnivore_url: string;
  omnivore_api_key: string;
  marreta_url: string;
  archive_url: string;
  direct_domains: string;
  archive_domains: string;
  default_view: string;
  digest_also_count: string;
  digest_quick_count: string;
  digest_daily_at: string;
  digest_weekly_at: string;
  digest_tz: string;
  digest_rerank: string;
}

// How densely the home grid draws its articles.
export type Density = "cards" | "list" | "compact";

export interface FeedDto {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  article_count: number;
  enabled: number;
  folder_id: number | null;
  // Consecutive failed refreshes. A catalog publication is retired
  // automatically once this gets high; a subscription is the reader's own, so
  // it is only reported.
  failures: number;
}

export interface FolderDto {
  id: number;
  name: string;
  include_in_main: number;
  include_in_digest: number;
  position: number;
  feed_count: number;
}

export interface ArticleDto {
  id: number;
  feed_id: number;
  title: string;
  link: string;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  topic: string | null;
  feed_title: string;
}

export type DigestKind = "daily" | "weekly";

// "rest" is everything the digest ranked but did not lay out — it backs the
// "Show all N remaining" expansion, and storing it keeps that list part of the
// frozen snapshot instead of a live re-query.
export type DigestSection = "lead" | "also" | "quick" | "rest";

export interface DigestItemDto {
  article_id: number;
  section: DigestSection;
  position: number;
  // Only lead and also carry an annotation; quick hits and the tail are
  // headline-only by design.
  summary: string | null;
  reading_minutes: number | null;
  title: string;
  link: string;
  image_url: string | null;
  published_at: string | null;
  topic: string | null;
  feed_id: number;
  feed_title: string;
  site_url: string | null;
}

export interface DigestDto {
  kind: DigestKind;
  period_key: string;
  period_start: string;
  period_end: string;
  built_at: string;
  three_lines: string[];
  total_articles: number;
  total_publications: number;
  // NULL on both when the annotations came from the extractive fallback.
  llm_provider: string | null;
  llm_model: string | null;
  items: DigestItemDto[];
}

// Discover: publications the user hasn't subscribed to. The article DTO adds
// the publication's identity and subscription state, because in the articles
// view the publication lives in the card footer next to Follow.
export interface CatalogArticleDto {
  id: number;
  feed_id: number;
  title: string;
  link: string;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  topic: string | null;
  feed_title: string;
  site_url: string | null;
  is_subscribed: boolean;
  score: number;
}

export interface CatalogPublicationDto {
  id: number;
  title: string;
  site_url: string | null;
  description: string | null;
  posts_per_week: number | null;
  topics: string[];
  is_subscribed: boolean;
  // The three that make the case for the publication, and how many the
  // catalog holds in total — the block offers the rest only when there is a
  // rest to offer.
  articles: CatalogArticleDto[];
  article_count: number;
}

export type DiscoverView = "publications" | "articles";

// The reader: one article's extracted body, its outline, and which hop of the
// unlock chain produced it.
export type ExtractSource =
  | "feed"
  | "direct"
  // The article as the page shipped it for its own client-side rendering.
  | "state"
  | "amp"
  | "marreta"
  | "archive";

export interface ReaderHeading {
  // Assigned during sanitising, so the outline and the body agree.
  id: string;
  text: string;
  level: number;
}

export interface ArticleContentDto {
  article_id: number;
  // "missing" is the answer GET gives before anything has been extracted; it
  // is not stored, and it is what tells the reader to POST.
  status: "ok" | "failed" | "missing";
  html: string | null;
  headings: ReaderHeading[];
  reading_minutes: number | null;
  source: ExtractSource | null;
  extracted_at: string | null;
}

export interface ReadingItemDto {
  id: number;
  // The article this snapshot came from, when the row still exists. NULL once
  // the article has been trimmed away — the saved item stays, the reader just
  // has nothing to extract from and falls back to the original.
  article_id: number | null;
  feed_id: number | null;
  link: string;
  title: string;
  summary: string | null;
  image_url: string | null;
  feed_title: string | null;
  published_at: string | null;
  added_at: string;
}

const AVATAR_TONES = [
  "#c96442",
  "#7d9a6d",
  "#6d87a8",
  "#b08b5e",
  "#9a7d9e",
  "#5e9a94",
  "#b0755e",
  "#8a94b0",
];

export function feedTone(feedId: number): string {
  return AVATAR_TONES[feedId % AVATAR_TONES.length];
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
