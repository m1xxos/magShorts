"use client";

import { useEffect, useState } from "react";

interface SettingsForm {
  omnivore_url: string;
  omnivore_api_key: string;
  marreta_url: string;
  direct_domains: string;
}

export function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then(setForm);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
        {hint && <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span>}
      </label>
    );
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
        <h2 className="font-serif text-xl text-ink">Settings</h2>
        <form onSubmit={submit} className="mt-5 space-y-4">
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
          {field(
            "Marreta URL",
            "marreta_url",
            "https://marreta.link",
            "Articles open through this instance by default."
          )}
          {field(
            "Open directly (skip Marreta)",
            "direct_domains",
            "habr.com, theverge.com",
            "Comma-separated domains without a paywall — they open at the original site."
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
