"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { SearchField, SearchIcon } from "./SearchField";
import { Sheet } from "./ui/Sheet";

function MenuIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function TopBar({
  selectedFeedId,
  username,
  nav,
  searchQuery,
}: {
  selectedFeedId?: number | null;
  username?: string;
  // The same rail the wide layout puts down the side, for the widths that have
  // no room to stand one. Without it the digest, Discover, Your reading and
  // the settings had no entrance at all below 1024px.
  //
  // Given the closer rather than handed over as a finished element: choosing a
  // feed on the home page changes the grid without changing the route, so
  // nothing unmounts and the sheet would sit there covering what it just did.
  nav?: (close: () => void) => ReactNode;
  // Pre-fills the box on the results page, so the header field and the URL
  // never disagree about what was searched for.
  searchQuery?: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const router = useRouter();
  const shortsHref = selectedFeedId
    ? `/shorts?feed=${selectedFeedId}`
    : "/shorts";

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-5 backdrop-blur md:px-8">
        <div className="flex items-center gap-2">
          {nav && (
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open the menu"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-paper-sunken hover:text-ink lg:hidden pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <MenuIcon />
            </button>
          )}
          <Link href="/" className="flex items-baseline gap-0.5">
            <span className="font-serif text-2xl tracking-tight text-ink">
              mag
            </span>
            <span className="font-serif text-2xl tracking-tight text-clay">
              Shorts
            </span>
          </Link>
        </div>
        {/* The middle of the bar was empty; search is the thing that wanted
            it. Below sm there is no room for a field, so it becomes the icon
            and the results page carries the box instead. */}
        <SearchField
          initial={searchQuery ?? ""}
          className="mx-4 hidden min-w-0 max-w-md flex-1 sm:flex"
        />
        <Link
          href="/search"
          aria-label="Search"
          className="ml-auto mr-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition hover:bg-paper-sunken hover:text-ink sm:hidden pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <SearchIcon size={17} />
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={shortsHref}
            className="flex items-center gap-2 rounded-full bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
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
      {/* Outside the header on purpose: its backdrop-blur makes it the
          containing block for anything fixed inside it, which pinned the
          sheet to a 64px-tall box. */}
      {nav && (
        <Sheet open={navOpen} onClose={() => setNavOpen(false)} full>
          {nav(() => setNavOpen(false))}
        </Sheet>
      )}
    </>
  );
}
