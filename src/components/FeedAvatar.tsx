"use client";

import { useState } from "react";
import { feedTone } from "@/lib/types";

function faviconUrl(siteUrl: string, size: number): string | null {
  try {
    const host = new URL(siteUrl).hostname;
    const wanted = size <= 32 ? 32 : 64;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=${wanted}`;
  } catch {
    return null;
  }
}

export function FeedAvatar({
  feedId,
  title,
  siteUrl,
  size = 28,
}: {
  feedId: number;
  title: string;
  siteUrl?: string | null;
  size?: number;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const icon = siteUrl && !iconFailed ? faviconUrl(siteUrl, size) : null;

  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        loading="lazy"
        onError={() => setIconFailed(true)}
        className="shrink-0 rounded-full border border-line bg-paper-raised object-cover p-[3px]"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-serif text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        backgroundColor: feedTone(feedId),
      }}
    >
      {title.trim().charAt(0).toUpperCase()}
    </span>
  );
}
