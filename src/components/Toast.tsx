"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastState {
  message: string;
  error?: boolean;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, error = false) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, error });
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        className={`rounded-full border px-5 py-2.5 text-sm shadow-lg backdrop-blur ${
          toast.error
            ? "border-clay/40 bg-clay-soft text-clay"
            : "border-line bg-paper-raised/95 text-ink"
        }`}
      >
        {toast.message}
      </div>
    </div>
  );
}
