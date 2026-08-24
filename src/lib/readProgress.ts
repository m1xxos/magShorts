"use client";

// How far through each article this browser got.
//
// It lived inside Reader.tsx, which was fine while the reader was the only
// thing that cared. Read later needs it too — a saved item that is 40% read
// should say so and offer Continue rather than Read — and the two must agree
// on the same map, the same keys and the same idea of what counts as started.
//
// Deliberately still localStorage and not a table: it is a scroll position in
// one browser, not a fact about the article, and syncing it would mean either
// a write per scroll frame or lying about which device you left off on.

const PROGRESS_KEY = "ms_read_progress";

// Under this the reader never scrolled anywhere — a tap that bounced. Over it,
// the article is finished and offering to continue is noise. Reader.tsx uses
// the same two numbers to decide whether restoring a position is worth it.
const STARTED = 0.02;
const FINISHED = 0.98;

export function readProgress(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function writeProgress(articleId: number, fraction: number): void {
  const stored = readProgress();
  stored[String(articleId)] = fraction;
  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(stored));
}

// The fraction worth acting on, or null. Null covers all three of "never
// opened", "opened and bounced" and "finished" — none of which should show a
// percentage or say Continue.
export function partialProgress(
  progress: Record<string, number>,
  articleId: number | null
): number | null {
  if (articleId === null) return null;
  const stored = progress[String(articleId)];
  if (typeof stored !== "number" || stored <= STARTED || stored >= FINISHED) {
    return null;
  }
  return stored;
}
