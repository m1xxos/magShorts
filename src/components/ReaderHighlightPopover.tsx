"use client";

import { useEffect, useRef } from "react";

// The bar that appears over a selection, or over a highlight you clicked.
//
// Positioned `fixed` from the selection's own client rect: the reader is a
// fixed overlay, so viewport coordinates need no scroll arithmetic and no
// positioned ancestor. The caller repositions it from the scroll handler it
// already runs.
//
// Escape is handled here in the capture phase, the way Menu and Sheet do it, so
// it closes the bar before the reader's own handler closes the article.
//
// The note editor used to live in this component behind an `editing` flag. It
// is its own component now (ReaderNoteEditor): the two have different lifetimes
// — a bar dies with the selection, a draft must not — and on a touch screen
// they are not even the same kind of surface.

export interface PopoverAt {
  top: number;
  bottom: number;
  left: number;
}

const WIDTH = 236;

export function ReaderHighlightPopover({
  at,
  existing,
  hasNote,
  onHighlight,
  onNote,
  onDelete,
  onClose,
  // Below the selection on a touch screen: iOS puts its own callout above it,
  // and two bars stacked on one edge is a fight nobody wins.
  below,
}: {
  at: PopoverAt;
  // True when a saved highlight was clicked rather than text selected.
  existing: boolean;
  hasNote: boolean;
  onHighlight: () => void;
  onNote: () => void;
  onDelete?: () => void;
  onClose: () => void;
  below: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }
    function onPointerDown(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  const left = Math.max(
    12,
    Math.min(at.left - WIDTH / 2, window.innerWidth - WIDTH - 12)
  );
  const top = below
    ? Math.min(at.bottom + 10, window.innerHeight - 72)
    : Math.max(96, at.top - 52);

  return (
    <div
      ref={box}
      style={{ position: "fixed", top, left, width: WIDTH }}
      className="z-[60] rounded-2xl border border-line bg-paper-raised p-1.5 shadow-[0_16px_44px_-18px_rgba(31,30,27,0.5)]"
    >
      <div className="flex items-center gap-1">
        {existing ? (
          <>
            {/* "Add a note" on something that already has one is a lie about
                what the button does. */}
            <Action label={hasNote ? "Edit note" : "Add a note"} onClick={onNote} />
            <span className="h-5 w-px bg-line" />
            <Action label="Remove" onClick={onDelete} destructive />
          </>
        ) : (
          <>
            <Action label="Highlight" onClick={onHighlight} />
            <span className="h-5 w-px bg-line" />
            <Action label="Add a note" onClick={onNote} />
          </>
        )}
      </div>
    </div>
  );
}

function Action({
  label,
  onClick,
  destructive = false,
}: {
  label: string;
  onClick?: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl px-[18px] py-2 text-[13px] whitespace-nowrap transition pointer-coarse:min-h-11 pointer-coarse:text-[15px] ${
        destructive
          ? "text-clay hover:bg-clay-soft"
          : "text-ink-soft hover:bg-paper-sunken hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
