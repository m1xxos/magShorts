// How long a piece takes to read.
//
// The same six lines existed privately in digest.ts and extract.ts, and Shorts
// now wants the number too. Three copies of a constant is how two surfaces end
// up quoting different minutes for the same article.

const WORDS_PER_MINUTE = 200;

export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

// The same, from a feed body that is still markup. Tags are stripped first:
// counting them inflates a short post with heavy formatting into a long one.
export function readingMinutesFromHtml(html: string | null): number | null {
  const text = (html ?? "").replace(/<[^>]*>/g, " ").trim();
  if (!text) return null;
  return readingMinutes(text);
}
