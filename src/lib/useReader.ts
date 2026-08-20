"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { type ArticleDto } from "./types";

// The reader's URL state, shared by every page that hosts it.
//
// The reader is an overlay, not a route: the list underneath keeps its
// articles, its pagination and its scroll position, which is the whole reason
// closing the reader puts you back exactly where you were. What it does change
// is the URL — Next supports window.history.pushState directly and keeps its
// router in sync with it — so the view is linkable and the browser's Back
// button closes the reader instead of leaving the site.
//
// One history entry, not one per article: following "Up next" replaces the
// entry rather than stacking, so Back is always "return to the list" and never
// "walk back through four articles".

export interface ReaderState {
  article: ArticleDto | null;
  open: (article: ArticleDto) => void;
  close: () => void;
}

export function useReader(
  resolve: (id: number) => Promise<ArticleDto | null>
): ReaderState {
  const [article, setArticle] = useState<ArticleDto | null>(null);
  // The same value as `article`, readable synchronously from the callbacks
  // below without making them depend on a re-render.
  const current = useRef<ArticleDto | null>(null);
  // Did we add the history entry ourselves? A reader opened by a pasted link
  // has nothing to go back to, so it closes by rewriting the URL instead.
  const pushed = useRef(false);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);

  const show = useCallback((next: ArticleDto | null) => {
    current.current = next;
    setArticle(next);
  }, []);

  const open = useCallback(
    (next: ArticleDto) => {
      // Keep whatever the page already had in the URL (?feed=, ?folder=,
      // ?view=): the grid resolves its selection from those on a reload, and
      // dropping them would reopen the reader over the wrong list.
      const params = new URLSearchParams(window.location.search);
      params.set("article", String(next.id));
      const url = `${window.location.pathname}?${params.toString()}`;
      if (current.current) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
        pushed.current = true;
      }
      show(next);
    },
    [show]
  );

  const close = useCallback(() => {
    if (!current.current) return;
    if (pushed.current) {
      pushed.current = false;
      // popstate does the closing, so there is one path out and the Back
      // button and the × cannot drift apart.
      window.history.back();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.delete("article");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
    show(null);
  }, [show]);

  useEffect(() => {
    let cancelled = false;
    async function sync() {
      const raw = new URLSearchParams(window.location.search).get("article");
      const id = Number(raw);
      if (!raw || !Number.isInteger(id) || id <= 0) {
        pushed.current = false;
        show(null);
        return;
      }
      if (current.current?.id === id) return;
      const found = await resolveRef.current(id);
      if (!cancelled) show(found);
    }
    window.addEventListener("popstate", sync);
    // Also on mount, so a pasted or reloaded ?article= link opens the reader.
    void sync();
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", sync);
    };
  }, [show]);

  return { article, open, close };
}

// Anchor props for anything that opens the reader. Kept a real link with a
// real href — the same URL the reader pushes — so middle-click and "open in
// new tab" land on the article instead of doing nothing, and the modified
// clicks the browser should handle are left to the browser.
export function readerLink(
  article: ArticleDto,
  open: (article: ArticleDto) => void
): { href: string; onClick: (event: MouseEvent) => void } {
  return {
    href: `?article=${article.id}`,
    onClick: (event: MouseEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      open(article);
    },
  };
}
