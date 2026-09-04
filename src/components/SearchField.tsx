"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

// The one box. It lives in the top bar and is pre-filled from ?q= on the
// results page, so there is one input to look at rather than two that have to
// be kept agreeing with each other.
export function SearchField({
  initial = "",
  className = "",
  autoFocus = false,
}: {
  initial?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  // Following a result and coming back changes the URL, not this component,
  // so the box has to be told. Adjusted during render rather than in an
  // effect: an effect would paint the old query first and then correct it.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValue(initial);
  }

  // "/" is the search key everywhere else on the web, and it is free here.
  // Not while you are typing somewhere else, obviously — including inside the
  // reader's note editor, which is a plain textarea.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      input.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
      }}
      className={`flex items-center gap-2.5 rounded-xl border border-line bg-paper-raised px-3.5 py-2 focus-within:border-clay ${className}`}
    >
      <span className="shrink-0 text-ink-faint">
        <SearchIcon />
      </span>
      <input
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoFocus={autoFocus}
        placeholder="Search titles and tags"
        aria-label="Search articles"
        className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
      />
    </form>
  );
}
