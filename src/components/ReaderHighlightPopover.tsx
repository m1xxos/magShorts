"use client";

import { useEffect, useRef, useState } from "react";

// The bar that appears over a selection, and the note card behind it.
//
// Positioned `fixed` from the selection's own client rect: the reader is a
// fixed overlay, so viewport coordinates need no scroll arithmetic and no
// positioned ancestor. The caller repositions it from the scroll handler it
// already runs.
//
// Escape is handled here, in the capture phase, the same way Menu and Sheet do
// it — so it peels the note, then the bar, and only then reaches the reader's
// own handler and closes the article.

export interface PopoverAt {
  top: number;
  bottom: number;
  left: number;
}

export function ReaderHighlightPopover({
  at,
  note,
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
  // Present when an existing highlight was clicked rather than text selected.
  note: string | null;
  hasNote: boolean;
  onHighlight: () => void;
  onNote: (note: string) => void;
  onDelete?: () => void;
  onClose: () => void;
  below: boolean;
}) {
  const [editing, setEditing] = useState(note !== null && hasNote);
  const [draft, setDraft] = useState(note ?? "");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (editing && note === null) setEditing(false);
      else onClose();
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
  }, [editing, note, onClose]);

  const width = editing ? 320 : 232;
  const left = Math.max(12, Math.min(at.left - width / 2, window.innerWidth - width - 12));
  const top = below ? at.bottom + 10 : Math.max(96, at.top - 52);

  return (
    <div
      ref={box}
      style={{ position: "fixed", top, left, width }}
      className="z-[60] rounded-2xl border border-line bg-paper-raised p-1.5 shadow-[0_16px_44px_-18px_rgba(31,30,27,0.5)]"
    >
      {editing ? (
        <div className="p-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter saves; the note is a remark, not an essay. Shift+Enter
              // is there for the times it is.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onNote(draft.trim());
              }
            }}
            placeholder="What about this?"
            rows={3}
            className="w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-clay"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {onDelete ? (
              <button
                onClick={onDelete}
                className="rounded-full px-2.5 py-1.5 text-[12.5px] text-clay transition hover:bg-clay-soft pointer-coarse:min-h-11"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={() => onNote(draft.trim())}
              className="rounded-full bg-clay px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:brightness-95 pointer-coarse:min-h-11"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {note === null ? (
            <>
              <Action label="Highlight" onClick={onHighlight} />
              <span className="h-5 w-px bg-line" />
              <Action label="Add a note" onClick={() => setEditing(true)} />
            </>
          ) : (
            <>
              <Action label="Add a note" onClick={() => setEditing(true)} />
              <span className="h-5 w-px bg-line" />
              <Action label="Remove" onClick={onDelete} destructive />
            </>
          )}
        </div>
      )}
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
      className={`flex-1 rounded-xl px-3 py-2 text-[13px] whitespace-nowrap transition pointer-coarse:min-h-11 pointer-coarse:text-[15px] ${
        destructive
          ? "text-clay hover:bg-clay-soft"
          : "text-ink-soft hover:bg-paper-sunken hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
