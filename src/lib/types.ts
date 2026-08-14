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
}

export interface FolderDto {
  id: number;
  name: string;
  include_in_main: number;
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

export interface ReadingItemDto {
  id: number;
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
