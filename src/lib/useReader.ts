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
// One entry per article, and the depth rides in the history entry itself.
// Following "Up next" stacks, so Back returns to the article you were reading
// rather than dumping you out of the reading altogether — and the "← Back to
// …" button still leaves for the list in one press, by unwinding as many
// entries as it pushed.
//
// The depth lives in history.state rather than in a ref because a ref cannot
// survive what a reader actually does to it: Back, then Forward, then close.
// The entry knows how deep it is; nothing here has to remember.

// Where the depth is kept inside history.state.
const DEPTH = "msReaderDepth";

function depthOf(state: unknown): number {
  const depth = (state as Record<string, unknown> | null)?.[DEPTH];
  return typeof depth === "number" && depth > 0 ? depth : 0;
}

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
  // Set while close() unwinds the stack. The entry it lands on may itself be
  // a reader — arriving on a pasted ?article= link and then following Up next
  // leaves one underneath — and closing has to mean the list either way.
  const closing = useRef(false);
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
      // Only our own key. Next patches pushState and bails out early on
      // anything carrying its __NA marker — that is how it recognises its own
      // calls — so spreading the existing state means the entry is pushed but
      // the router is never told the URL moved, and usePathname and
      // useSearchParams go stale until something rewrites the address bar back.
      // The patch copies Next's internals onto whatever we pass, so they are
      // not lost by leaving them out.
      window.history.pushState(
        { [DEPTH]: depthOf(window.history.state) + 1 },
        "",
        readerUrl(next.id)
      );
      show(next);
    },
    [show]
  );

  // Strip ?article= from wherever we are standing and show the list. The way
  // out for a reader with nothing behind it to go back to.
  const dropParam = useCallback(() => {
    closing.current = false;
    const params = new URLSearchParams(window.location.search);
    params.delete("article");
    const query = params.toString();
    window.history.replaceState(
      { [DEPTH]: depthOf(window.history.state) },
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
    show(null);
  }, [show]);

  const close = useCallback(() => {
    // history.go is asynchronous, so without this a held Escape key or a
    // double-clicked × fires it again on the same entry — four articles deep
    // that is go(-4) twice, which walks clean off the site.
    if (!current.current || closing.current) return;
    const depth = depthOf(window.history.state);
    if (depth > 0) {
      // Unwind every entry this reader pushed, however many articles deep the
      // reading went. popstate does the closing, so there is one path out and
      // the Back button and the × cannot drift apart.
      closing.current = true;
      window.history.go(-depth);
      return;
    }
    dropParam();
  }, [dropParam]);

  useEffect(() => {
    // Per call, not per effect: two quick presses of Back start two resolves,
    // and without this the slower one lands last and shows the article you
    // just left.
    let latest = 0;
    async function sync() {
      const token = ++latest;
      const raw = new URLSearchParams(window.location.search).get("article");
      const id = Number(raw);
      if (!raw || !Number.isInteger(id) || id <= 0) {
        closing.current = false;
        show(null);
        return;
      }
      // Landed back on an article while closing: the reading started from a
      // link to this one, so there is no list entry to unwind to. Leave it
      // the only way left.
      if (closing.current) {
        closing.current = false;
        dropParam();
        return;
      }
      if (current.current?.id === id) return;
      const found = await resolveRef.current(id);
      if (token === latest) show(found);
    }
    window.addEventListener("popstate", sync);
    // Also on mount, so a pasted or reloaded ?article= link opens the reader.
    void sync();
    return () => {
      // Nothing in flight may win after this effect is torn down.
      latest++;
      window.removeEventListener("popstate", sync);
    };
  }, [show, dropParam]);

  return { article, open, close };
}

// Anchor props for anything that opens the reader. Kept a real link with a
// real href — the same URL the reader pushes — so middle-click and "open in
// new tab" land on the article instead of doing nothing, and the modified
// clicks the browser should handle are left to the browser.
// The URL the reader pushes, with whatever the page already had in it. The
// grid resolves its selection from ?feed= / ?folder= / ?view= on a cold load,
// so a link that dropped them would open a new tab on the wrong list.
function readerUrl(articleId: number): string {
  if (typeof window === "undefined") return `?article=${articleId}`;
  const params = new URLSearchParams(window.location.search);
  params.set("article", String(articleId));
  return `${window.location.pathname}?${params.toString()}`;
}

export function readerLink(
  article: ArticleDto,
  open: (article: ArticleDto) => void
): { href: string; onClick: (event: MouseEvent) => void } {
  return {
    href: readerUrl(article.id),
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
