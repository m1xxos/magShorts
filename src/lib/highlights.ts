"use client";

import { type Anchor } from "./anchor";
import { type ArticleDto, type HighlightDto } from "./types";

// The client's half of the highlight API, in the shape actions.ts already uses:
// every call answers, nothing throws at a caller mid-render.

export async function listHighlights(link: string): Promise<HighlightDto[]> {
  try {
    const response = await fetch(
      `/api/highlights?link=${encodeURIComponent(link)}`
    );
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body) ? (body as HighlightDto[]) : [];
  } catch {
    return [];
  }
}

// The count per article, for a list that wants to say what is waiting in each
// one without fetching the highlights themselves.
export async function highlightCounts(): Promise<Map<string, number>> {
  try {
    const response = await fetch("/api/highlights?counts=1");
    if (!response.ok) return new Map();
    const rows = (await response.json()) as Array<{ link: string; count: number }>;
    return new Map(rows.map((row) => [row.link, row.count]));
  } catch {
    return new Map();
  }
}

export async function createHighlight(
  article: ArticleDto,
  anchor: Anchor,
  bodyHash: string | null,
  note: string | null
): Promise<HighlightDto | null> {
  try {
    const response = await fetch("/api/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        link: article.link,
        // Snapshots, so the highlight still names its article after the
        // Discover trim has taken the article itself.
        article_title: article.title,
        feed_title: article.feed_title,
        published_at: article.published_at,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        start_offset: anchor.start,
        end_offset: anchor.end,
        body_hash: bodyHash,
        note,
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as HighlightDto;
  } catch {
    return null;
  }
}

export async function updateHighlight(
  id: number,
  note: string
): Promise<boolean> {
  try {
    const response = await fetch(`/api/highlights/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteHighlight(id: number): Promise<boolean> {
  try {
    const response = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

export interface Reanchored {
  id: number;
  start_offset?: number;
  end_offset?: number;
  body_hash?: string | null;
  orphaned?: boolean;
}

// Fire-and-forget: the reader has already drawn the highlights where it found
// them, and this only writes down where that was.
export function reanchor(items: Reanchored[]): void {
  if (items.length === 0) return;
  void fetch("/api/highlights/reanchor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }).catch(() => {});
}

// Everything kept out of one article, as text you can paste somewhere else.
//
// Reading order, quote then note, a blank line between. Orphans come last
// under their own line rather than being dropped: they are still yours, and a
// clipboard that quietly loses three of them is worse than one that explains
// itself.
export function highlightsAsText(
  highlights: HighlightDto[],
  markdown: boolean,
  article?: { title: string; link: string }
): string {
  const block = (highlight: HighlightDto) => {
    const quote = markdown
      ? highlight.quote
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")
      : highlight.quote;
    return highlight.note ? `${quote}\n${highlight.note}` : quote;
  };

  const live = highlights.filter((highlight) => !highlight.orphaned);
  const lost = highlights.filter((highlight) => highlight.orphaned);
  const parts: string[] = [];
  if (markdown && article) {
    parts.push(`## [${article.title}](${article.link})`);
  }
  parts.push(...live.map(block));
  if (lost.length > 0) {
    parts.push("Not in this version of the article");
    parts.push(...lost.map(block));
  }
  return parts.join("\n\n");
}
