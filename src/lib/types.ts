export type Selection =
  | { kind: "forYou" }
  | { kind: "all" }
  | { kind: "feed"; feedId: number }
  | { kind: "folder"; folderId: number };

export type RecWindow = "day" | "week" | "month";

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
  feed_title: string;
  tags?: string | null;
}

// Dot colors for auto-assigned topic tags (slugs come from lib/tags.ts).
export const TAG_COLORS: Record<string, string> = {
  k8s: "#e8964f",
  docker: "#7ec86e",
  "ci/cd": "#5fc8dd",
  iac: "#5fc8dd",
  ansible: "#8fd45f",
  devops: "#e8964f",
  monitoring: "#5fc8dd",
  logging: "#f06292",
  security: "#e9c845",
  auth: "#b57fdc",
  networking: "#e9c845",
  linux: "#e9c845",
  paas: "#f06292",
  cloud: "#6d9fe8",
  databases: "#b57fdc",
  ai: "#b57fdc",
  programming: "#f06292",
  "comp-sci": "#f06292",
  web: "#6d9fe8",
  hardware: "#e8964f",
  performance: "#7ec86e",
  opensource: "#7ec86e",
  politics: "#e05d5d",
  business: "#6d9fe8",
  economy: "#e9c845",
  science: "#5fc8dd",
  space: "#b57fdc",
  climate: "#7ec86e",
  health: "#f06292",
  psychology: "#b57fdc",
  culture: "#e8964f",
  music: "#f06292",
  "film-tv": "#e05d5d",
  books: "#e8964f",
  media: "#6d9fe8",
  history: "#e9c845",
  society: "#6d9fe8",
  education: "#7ec86e",
  food: "#e8964f",
  travel: "#5fc8dd",
  sports: "#7ec86e",
  gaming: "#b57fdc",
  design: "#f06292",
  crime: "#e05d5d",
};

export function articleTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
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
