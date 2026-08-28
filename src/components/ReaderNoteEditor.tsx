"use client";

import { useEffect, useRef } from "react";
import { Sheet } from "./ui/Sheet";
import { type PopoverAt } from "./ReaderHighlightPopover";

// Writing the note.
//
// On a mouse this is a card anchored to the passage, as it always was. On a
// touch screen it is a sheet, because the action is typing and the keyboard is
// therefore guaranteed: a 320px card positioned from the selection lands under
// the keyboard about half the time, and there is no arithmetic that reliably
// says where the keyboard will be.
//
// The draft lives in the caller, not here. `Sheet` unmounts its children when
// it closes, and it can be closed by dragging it down — so a draft kept inside
// would be destroyed by a gesture that is meant to be recoverable.

export function ReaderNoteEditor({
  at,
  quote,
  draft,
  onDraft,
  onSave,
  onCancel,
  onDelete,
  touch,
  below,
}: {
  at: PopoverAt;
  // The passage being annotated: the selection for a new highlight, the stored
  // quote for one that already exists. Shown above the field, because a note
  // written without the sentence in front of you is a note about nothing.
  quote: string;
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  touch: boolean;
  below: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (touch) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    }
    function onPointerDown(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) onCancel();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onCancel, touch]);

  const field = (
    <textarea
      autoFocus
      value={draft}
      onChange={(event) => onDraft(event.target.value)}
      onKeyDown={(event) => {
        // Enter saves; a note is a remark, not an essay. Shift+Enter is there
        // for the times it is.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSave();
        }
      }}
      placeholder="What about this?"
      className={
        touch
          ? "min-h-24 w-full resize-none rounded-2xl border border-clay bg-paper px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink-faint"
          : "w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-clay"
      }
      rows={touch ? 4 : 3}
    />
  );

  const actions = (
    <div className="mt-3 flex items-center justify-between gap-2">
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className={`rounded-full px-3 text-[13px] text-clay transition hover:bg-clay-soft ${
            touch ? "min-h-12" : "py-1.5"
          }`}
        >
          Delete highlight
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {/* Cancel is not decoration: dismissing by tapping outside is not
            discoverable, and it used to drop the draft without saying so. */}
        <button
          type="button"
          onClick={onCancel}
          className={`rounded-full border border-line px-4 text-[13px] text-ink-soft transition hover:border-clay hover:text-clay ${
            touch ? "min-h-12" : "py-1.5"
          }`}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          className={`rounded-full bg-clay px-4 text-[13px] font-medium text-white transition hover:brightness-95 ${
            touch ? "min-h-12" : "py-1.5"
          }`}
        >
          Save
        </button>
      </div>
    </div>
  );

  const passage = (
    <p
      className={`border-l-2 border-clay pl-3 font-serif leading-[1.5] text-ink-soft ${
        touch ? "text-[17px]" : "line-clamp-3 text-[14px]"
      }`}
    >
      {quote}
    </p>
  );

  if (touch) {
    return (
      <Sheet open onClose={onCancel} title="Note">
        <div className="pb-4">
          {passage}
          <div className="mt-4">{field}</div>
          {actions}
        </div>
      </Sheet>
    );
  }

  const width = 320;
  const left = Math.max(
    12,
    Math.min(at.left - width / 2, window.innerWidth - width - 12)
  );
  const top = below
    ? Math.min(at.bottom + 10, window.innerHeight - 260)
    : Math.max(96, at.top - 52);

  return (
    <div
      ref={box}
      style={{ position: "fixed", top, left, width }}
      className="z-[60] rounded-2xl border border-line bg-paper-raised p-3 shadow-[0_16px_44px_-18px_rgba(31,30,27,0.5)]"
    >
      {passage}
      <div className="mt-3">{field}</div>
      {actions}
    </div>
  );
}
