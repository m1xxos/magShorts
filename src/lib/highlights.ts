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
