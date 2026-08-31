import { type ArticleDto } from "./types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function saveToReadingList(
  article: ArticleDto
): Promise<ActionResult> {
  try {
    const response = await fetch("/api/reading-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        link: article.link,
        title: article.title,
        summary: article.summary,
        image_url: article.image_url,
        feed_title: article.feed_title,
        published_at: article.published_at,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, message: body?.error ?? "Could not save" };
    }
    return { ok: true, message: "Saved to Read later" };
  } catch {
    return { ok: false, message: "Could not save" };
  }
}

export async function removeFromReadingList(
  link: string
): Promise<ActionResult> {
  try {
    const response = await fetch(
      `/api/reading-list?link=${encodeURIComponent(link)}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, message: body?.error ?? "Could not remove" };
    }
    return { ok: true, message: "Removed from Read later" };
  } catch {
    return { ok: false, message: "Could not remove" };
  }
}


export function unlockUrl(articleLink: string): string {
  return `/api/unlock?url=${encodeURIComponent(articleLink)}`;
}

// Covers go through the local disk cache; the route 302s to the origin when
// the image can't be cached, so this is always safe to use.
export function cachedImageUrl(imageUrl: string): string {
  return `/api/images?u=${encodeURIComponent(imageUrl)}`;
}

export type FeedbackAction =
  | "like"
  | "dislike"
  | "skip"
  | "open"
  | "dwell"
  | "view"
  | "read";

// Fire-and-forget taste signal; keepalive lets it survive navigation.
//
// `seconds` belongs to "read" and nothing else: it is how long the reader was
// on screen, and it is the only number on the stats page that isn't a guess.
export function recordEvent(
  link: string,
  action: FeedbackAction,
  title?: string,
  seconds?: number
): void {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ link, action, title, seconds }),
    keepalive: true,
  }).catch(() => {});
}
