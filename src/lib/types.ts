export interface FeedDto {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  article_count: number;
  enabled: number;
}

export interface ArticleDto {
  id: number;
  feed_id: number;
  title: string;
  link: string;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  feed_title: string;
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
