"use client";

import { useState } from "react";

export function AddFeedDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Something went wrong, please try again");
        return;
      }
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-paper-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-ink">Add a publication</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Paste an RSS or Atom feed URL and it will join your subscriptions.
        </p>
        <form onSubmit={submit} className="mt-5">
          <input
            autoFocus
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/feed.xml"
            className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
          />
          {error && <p className="mt-2 text-sm text-clay">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {busy ? "Checking feed…" : "Subscribe"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
