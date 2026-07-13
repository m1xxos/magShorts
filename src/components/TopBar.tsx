"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function TopBar({
  selectedFeedId,
  username,
}: {
  selectedFeedId?: number | null;
  username?: string;
}) {
  const router = useRouter();
  const shortsHref = selectedFeedId ? `/shorts?feed=${selectedFeedId}` : "/shorts";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur md:px-8">
      <Link href="/" className="flex items-baseline gap-0.5">
        <span className="font-serif text-2xl tracking-tight text-ink">mag</span>
        <span className="font-serif text-2xl tracking-tight text-clay">Shorts</span>
      </Link>
      <div className="flex items-center gap-3">
        <Link
          href={shortsHref}
          className="flex items-center gap-2 rounded-full bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
          Shorts
        </Link>
        {username && (
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-ink-soft sm:inline">
              {username}
            </span>
            <button
              onClick={signOut}
              title="Sign out"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-faint transition hover:border-clay hover:text-clay"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
