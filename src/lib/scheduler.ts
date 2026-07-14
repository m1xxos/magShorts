import { refreshStaleFeeds } from "./rss";
import { prefetchImages } from "./imageCache";

const TICK_MS = 10 * 60 * 1000;
const STARTUP_DELAY_MS = 5_000;

let started = false;

async function tick(): Promise<void> {
  try {
    // Also kicks the embedding backfill in the background (see rss.ts).
    await refreshStaleFeeds();
    const prefetched = await prefetchImages();
    console.log(
      `[scheduler] feeds refreshed, ${prefetched} cover(s) prefetched`
    );
  } catch (error) {
    console.error("[scheduler] tick failed:", error);
  }
}

// Keeps feeds, embeddings and the image cache warm so no request ever pays
// for a cold refresh. Request handlers keep their lazy refresh as a fallback.
export function startScheduler(): void {
  if (started) return;
  started = true;
  setTimeout(tick, STARTUP_DELAY_MS);
  setInterval(tick, TICK_MS);
  console.log("[scheduler] started (every 10 min)");
}
