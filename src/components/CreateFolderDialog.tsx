"use client";

import { useState } from "react";

type FailedFeed = { url: string; error: string };

export function CreateFolderDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [includeInMain, setIncludeInMain] = useState(false);
  const [feedsText, setFeedsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [failed, setFailed] = useState<FailedFeed[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFailed([]);
    setProgress(null);
    try {
      const folderResponse = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, include_in_main: includeInMain }),
      });
      const folderBody = await folderResponse.json().catch(() => null);
      if (!folderResponse.ok) {
        setError(folderBody?.error ?? "Could not create the folder, please try again");
        return;
      }
      const folderId: number = folderBody.id;

      const urls = feedsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (urls.length === 0) {
        onCreated();
        onClose();
        return;
      }

      const failures: FailedFeed[] = [];
      for (let i = 0; i < urls.length; i += 1) {
        setProgress({ done: i, total: urls.length });
        const url = urls[i];
        try {
          const feedResponse = await fetch("/api/feeds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, folder_id: folderId }),
          });
          if (!feedResponse.ok) {
            const feedBody = await feedResponse.json().catch(() => null);
            failures.push({ url, error: feedBody?.error ?? `HTTP ${feedResponse.status}` });
          }
        } catch {
          failures.push({ url, error: "Network error" });
        }
      }
      setProgress({ done: urls.length, total: urls.length });

      // The folder now exists regardless of individual feed outcomes, so refresh
      // the sidebar either way.
      onCreated();

      if (failures.length > 0) {
        // Keep the dialog open so the user can see/copy what didn't get added.
        setFailed(failures);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-paper-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-ink">New folder</h2>
        <p className="mt-1 text-sm text-ink-faint">
          Group publications together. You can optionally add feeds right away.
        </p>
        <form onSubmit={submit} className="mt-5">
          <input
            autoFocus
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder name"
            className={inputClass}
          />

          <label className="mt-4 flex items-center justify-between gap-3">
            <span className="text-sm text-ink-soft">
              Include in{" "}
              <span className="text-ink">For you</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={includeInMain}
              onClick={() => setIncludeInMain((value) => !value)}
              className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
                includeInMain ? "bg-clay" : "bg-line"
              }`}
            >
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
                  includeInMain ? "left-[16px]" : "left-[2px]"
                }`}
              />
            </button>
          </label>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm text-ink-soft">
              Feeds{" "}
              <span className="text-ink-faint">— optional, one URL per line</span>
            </label>
            <textarea
              value={feedsText}
              onChange={(event) => setFeedsText(event.target.value)}
              rows={4}
              placeholder={"https://example.com/feed.xml\nhttps://another.site"}
              className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
            />
          </div>

          {busy && progress && progress.total > 0 && (
            <p className="mt-3 text-sm text-ink-faint">
              Adding feeds… {progress.done}/{progress.total}
            </p>
          )}

          {error && <p className="mt-2 text-sm text-clay">{error}</p>}

          {failed.length > 0 && (
            <div className="mt-3 rounded-xl border border-line bg-paper-sunken p-3 text-[13px]">
              <p className="text-ink-soft">
                Folder created. {failed.length}{" "}
                {failed.length === 1 ? "feed" : "feeds"} could not be added:
              </p>
              <ul className="mt-1.5 space-y-1">
                {failed.map((item) => (
                  <li key={item.url} className="text-ink-faint">
                    <span className="break-all text-ink-soft">{item.url}</span>
                    {" — "}
                    {item.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              {failed.length > 0 ? "Done" : "Cancel"}
            </button>
            {failed.length === 0 && (
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
              >
                {busy ? "Creating…" : "Create folder"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
