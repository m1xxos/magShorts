"use client";

import { useCallback, useSyncExternalStore } from "react";

// Media queries for the few places where the *element* has to differ.
//
// Almost everything responsive in this app is a Tailwind variant — `lg:`,
// `min-[1180px]:`, `pointer-coarse:` — and should stay that way: a class is
// evaluated by the browser at the real viewport size, with no hydration pass
// and no flash of the wrong layout. This hook is for the cases where two
// different components are involved, not two different styles: the reader's
// type controls are a popover on a mouse and a bottom sheet on a finger, and
// there is no class that turns one into the other.
//
// The server snapshot is always false, so the first paint is the mouse layout
// and touch corrects on hydration. That is the right way round: a desktop
// browser never sees a change, and a tablet's correction happens before the
// user can reach for the control.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

// A finger, not a mouse. Note this is about the pointing device, never about
// width: a 1194px iPad in landscape is wider than most laptop windows.
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
