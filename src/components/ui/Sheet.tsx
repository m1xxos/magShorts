"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// A panel that comes up from the bottom edge.
//
// Used where a popover would be wrong on a touch screen: the reader's Aa
// controls give each of five text sizes about 30px of tap area inside a 176px
// popover, and the outline has nowhere to go at all once the rail is gone.
//
// The drag is written here rather than borrowed from SwipeableCard: that
// component commits to a single axis the moment a gesture starts, and it is the
// interaction backbone of Shorts and the home grid. Thirty lines of vertical
// drag is cheaper than a second axis in the component two screens depend on.

const DISMISS_AFTER = 90;

export function Sheet({
  open,
  onClose,
  title,
  children,
  // Portrait Settings is a full-height sheet rather than a panel over the page.
  full = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  full?: boolean;
}) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    // Capture for the same reason as Menu: with a sheet open, Escape belongs to
    // the sheet, not to the reader behind it.
    document.addEventListener("keydown", onKey, true);
    // Restore the exact previous value rather than clearing it: the reader has
    // already locked the body, and a sheet closing must not unlock it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  function end() {
    if (start.current === null) return;
    start.current = null;
    if (drag > DISMISS_AFTER) onClose();
    setDrag(0);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/35"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined }}
        className={`relative flex max-h-[88vh] flex-col rounded-t-3xl border-t border-line bg-paper-raised pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-18px_50px_-24px_rgba(31,30,27,0.5)] ${
          drag ? "" : "transition-transform"
        } ${full ? "h-full max-h-full rounded-none" : ""}`}
      >
        <div
          onPointerDown={(event) => {
            start.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (start.current === null) return;
            setDrag(Math.max(0, event.clientY - start.current));
          }}
          onPointerUp={end}
          onPointerCancel={end}
          className="shrink-0 cursor-grab touch-none px-5 pt-3 pb-1"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-line" />
          {title && (
            <div className="mt-3 flex items-baseline justify-between">
              <h2 className="font-serif text-[19px] text-ink">{title}</h2>
              <button
                onClick={onClose}
                className="text-[13.5px] text-ink-faint transition hover:text-ink"
              >
                Done
              </button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1">{children}</div>
      </div>
    </div>
  );
}
