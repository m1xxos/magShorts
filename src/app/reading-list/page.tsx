"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ReadingItemDto, timeAgo } from "@/lib/types";
import { unlockUrl } from "@/lib/actions";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";
import { ExternalIcon } from "@/components/SwipeableCard";
import { useUser } from "@/lib/useUser";

export default function ReadingListPage() {
  const user = useUser();
  const [items, setItems] = useState<ReadingItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();

  useEffect(() => {
    if (!user) return;
    fetch("/api/reading-list")
      .then((response) => response.json())
      .then(setItems)
      .finally(() => setLoading(false));
  }, [user]);

  async function removeItem(item: ReadingItemDto) {
    await fetch(`/api/reading-list/${item.id}`, { method: "DELETE" });
    setItems((previous) => previous.filter((it) => it.id !== item.id));
    showToast("Removed from Read later");
  }

  return (
    <div className="min-h-screen">
      <TopBar username={user?.username} />
      <main className="mx-auto max-w-3xl px-5 py-8 md:px-8">
        <div className="flex items-baseline justify-between">
          <h1 className="font-serif text-3xl text-ink">Read later</h1>
          <Link href="/" className="text-sm text-clay hover:underline">
            ← Back to feed
          </Link>
        </div>

        {loading ? (
          <p className="py-20 text-center text-ink-faint">Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <p className="font-serif text-xl text-ink">Nothing saved yet</p>
            <p className="max-w-sm text-sm text-ink-faint">
              Swipe a card to the right (or use the bookmark button) and the
              article will wait for you here.
            </p>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="group flex gap-4 rounded-2xl border border-line bg-paper-raised p-4 transition hover:shadow-[0_8px_24px_-12px_rgba(31,30,27,0.2)]"
              >
                {item.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    loading="lazy"
                    className="hidden h-20 w-32 shrink-0 rounded-xl object-cover sm:block"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={unlockUrl(item.link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Opens paywall-free via Marreta"
                    className="line-clamp-2 font-serif text-[16px] leading-snug font-medium text-ink hover:text-clay"
                  >
                    {item.title}
                  </a>
                  <p className="mt-1 text-[13px] text-ink-faint">
                    {item.feed_title}
                    {item.feed_title && <span className="mx-1.5">·</span>}
                    saved {timeAgo(item.added_at.replace(" ", "T") + "Z") || "just now"}
                  </p>
                  {item.summary && (
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-soft">
                      {item.summary}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                  <button
                    title="Remove"
                    onClick={() => removeItem(item)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint opacity-0 transition group-hover:opacity-100 hover:bg-paper-sunken hover:text-ink"
                  >
                    ×
                  </button>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the original"
                    className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-clay hover:text-clay"
                  >
                    <ExternalIcon size={12} /> Original
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Toast toast={toast} />
    </div>
  );
}
