"use client";

import { useEffect, useState } from "react";
import { type FolderDto, type SettingsForm } from "@/lib/types";

// Only these are edited here. Saving must not send the per-domain lists, or a
// dialog opened before a change in Manage sources would write stale ones back
// (the PUT handler applies whatever keys it receives).
const EDITABLE: Array<keyof SettingsForm> = [
  "default_view",
  "marreta_url",
  "archive_url",
  "omnivore_url",
  "omnivore_api_key",
];

export function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then(setForm);
    fetch("/api/folders")
      .then((response) => response.json())
      .then((data: FolderDto[]) => {
        if (Array.isArray(data)) setFolders(data);
      });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(EDITABLE.map((key) => [key, form[key]]))
        ),
      });
      onSaved("Settings saved");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function field(
    label: string,
    key: keyof SettingsForm,
    placeholder: string,
    hint?: string,
    type: "text" | "password" = "text"
  ) {
    return (
      <label className="block">
        <span className="text-[13px] font-medium text-ink-soft">{label}</span>
        <input
          type={type}
          value={form?.[key] ?? ""}
          onChange={(event) =>
            setForm((prev) =>
              prev ? { ...prev, [key]: event.target.value } : prev
            )
          }
          placeholder={placeholder}
          className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
        />
        {hint && (
          <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span>
        )}
      </label>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-paper-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-ink">Settings</h2>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">
              Default view
            </span>
            <select
              value={form?.default_view ?? ""}
              onChange={(event) =>
                setForm((prev) =>
                  prev ? { ...prev, default_view: event.target.value } : prev
                )
              }
              className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none focus:border-clay"
            >
              <option value="">All publications</option>
              <option value="forYou">For you</option>
              {folders.map((folder) => (
                <option key={folder.id} value={`folder:${folder.id}`}>
                  {folder.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] text-ink-faint">
              What the home page opens with.
            </span>
          </label>

          <p className="pt-2 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
            How articles open
          </p>
          <p className="text-[12px] text-ink-faint">
            Whether a publication opens through Marreta, directly or via the
            archive is set per feed in Manage sources.
          </p>
          {field(
            "Marreta URL",
            "marreta_url",
            "https://marreta.link",
            "Articles open through this instance by default."
          )}
          {field(
            "Archive URL",
            "archive_url",
            "https://web.archive.org/web/",
            "Snapshot service used for “Archive” domains; the article URL is appended."
          )}

          <p className="pt-2 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
            Omnivore
          </p>
          {field(
            "Omnivore URL",
            "omnivore_url",
            "https://omnivore.example.com",
            "Your self-hosted Omnivore instance (swipe left sends articles there)."
          )}
          {field(
            "Omnivore API key",
            "omnivore_api_key",
            "xxxxxxxx-xxxx-…",
            undefined,
            "password"
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-paper-sunken"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !form}
              className="rounded-xl bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
