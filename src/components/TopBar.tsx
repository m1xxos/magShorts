import Link from "next/link";

export function TopBar({ selectedFeedId }: { selectedFeedId?: number | null }) {
  const shortsHref = selectedFeedId ? `/shorts?feed=${selectedFeedId}` : "/shorts";
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur md:px-8">
      <Link href="/" className="flex items-baseline gap-0.5">
        <span className="font-serif text-2xl tracking-tight text-ink">mag</span>
        <span className="font-serif text-2xl tracking-tight text-clay">Shorts</span>
      </Link>
      <Link
        href={shortsHref}
        className="flex items-center gap-2 rounded-full bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
        Shorts
      </Link>
    </header>
  );
}
