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

export async function sendToOmnivore(
  article: ArticleDto
): Promise<ActionResult> {
  try {
    const response = await fetch("/api/omnivore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: article.link }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, message: body?.error ?? "Could not send to Omnivore" };
    }
    return { ok: true, message: "Sent to Omnivore" };
  } catch {
    return { ok: false, message: "Could not send to Omnivore" };
  }
}

export function unlockUrl(articleLink: string): string {
  return `/api/unlock?url=${encodeURIComponent(articleLink)}`;
}
