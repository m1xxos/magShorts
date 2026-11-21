"use client";

import { useId, type Ref } from "react";
import { shortcuts, type KeyboardScope } from "@/lib/useKeyboardShortcuts";

export function KeyboardHelp({
  dialogRef,
  scope,
  vim,
}: {
  dialogRef: Ref<HTMLDialogElement>;
  scope: KeyboardScope;
  vim: boolean;
}) {
  const title = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={title}
      onClick={(event) => {
        event.stopPropagation();
        const dialog = event.currentTarget;
        if (event.target !== dialog) return;
        const { left, right, top, bottom } = dialog.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right ||
            event.clientY < top || event.clientY > bottom) dialog.close();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-line bg-paper-raised p-5 text-ink shadow-xl backdrop:bg-ink/25"
    >
      <h2 id={title} className="font-serif text-[19px]">Keyboard shortcuts</h2>
      <dl className="mt-3 space-y-2 text-[13px]">
        {shortcuts[scope].map(({ command, label, keys, vim: aliases }) => (
          <div key={command} className="flex items-center justify-between gap-3">
            <dt>{label}</dt>
            <dd className="flex flex-wrap justify-end gap-1">
              {[...keys, ...(vim ? aliases ?? [] : [])].map((key) => (
                <kbd key={key} className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-sans">
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <form method="dialog" className="mt-4 flex justify-end">
        <button autoFocus className="rounded-full border border-line px-4 py-1.5 text-sm">
          Done
        </button>
      </form>
    </dialog>
  );
}
