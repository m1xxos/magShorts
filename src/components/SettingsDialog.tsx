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
  "digest_also_count",
  "digest_quick_count",
  "digest_daily_at",
  "digest_weekly_at",
  "digest_tz",
  "digest_rerank",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Sun 19:00" → ["Sun", "19:00"], tolerating whatever is in the setting.
function splitWeekly(value: string): [string, string] {
  const match = value.trim().match(/^([A-Za-z]{3})\w*\s*(\d{1,2}:\d{2})?/);
  return [match?.[1] ?? "Sun", match?.[2] ?? "19:00"];
}

function Switch({
  checked,
  title,
  onClick,
}: {
  checked: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
        checked ? "bg-clay" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
          checked ? "left-[16px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

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

  const [weeklyDay, weeklyTime] = splitWeekly(form?.digest_weekly_at ?? "");
  // 1 lead + every "also" card + the three-lines panel.
  const llmCalls = 2 + (Number.parseInt(form?.digest_also_count ?? "", 10) || 0);

  function setField(key: keyof SettingsForm, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // Folder toggles are written straight through rather than on save: they live
  // on the folder, not in the settings blob, and the switch reading as applied
  // is the whole point of a switch.
  async function toggleDigestFolder(folder: FolderDto) {
    const next = folder.include_in_digest ? 0 : 1;
    setFolders((prev) =>
      prev.map((entry) =>
        entry.id === folder.id ? { ...entry, include_in_digest: next } : entry
      )
    );
    await fetch(`/api/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ include_in_digest: next === 1 }),
    });
  }

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

  function count(
    label: string,
    key: keyof SettingsForm,
    min: number,
    max: number
  ) {
    return (
      <label className="block">
        <span className="text-[13px] font-medium text-ink-soft">{label}</span>
        <input
          type="number"
          min={min}
          max={max}
          value={form?.[key] ?? ""}
          onChange={(event) => setField(key, event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none focus:border-clay"
        />
      </label>
    );
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
            Digest
          </p>

          <div>
            <span className="text-[13px] font-medium text-ink-soft">Sources</span>
            <span className="mt-1 mb-2 block text-[12px] text-ink-faint">
              Which folders the digest reads. Separate from For you — a folder
              can feed one and not the other. Feeds outside any folder always
              count.
            </span>
            {folders.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No folders yet.</p>
            ) : (
              <div className="space-y-1.5">
                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    className="flex items-center gap-3 rounded-xl border border-line px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
                      {folder.name}
                    </span>
                    <span className="text-[11px] tabular-nums text-ink-faint">
                      {folder.feed_count}
                    </span>
                    <Switch
                      checked={Boolean(folder.include_in_digest)}
                      title={
                        folder.include_in_digest
                          ? "In the digest — click to exclude"
                          : "Excluded from the digest — click to include"
                      }
                      onClick={() => toggleDigestFolder(folder)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {count("Also worth it", "digest_also_count", 0, 12)}
            {count("Quick hits", "digest_quick_count", 0, 20)}
          </div>
          <p className="-mt-2 text-[12px] text-ink-faint">
            The lead and every “also” card is written by the model, so this
            digest costs <strong className="font-medium">{llmCalls}</strong>{" "}
            model call{llmCalls === 1 ? "" : "s"} a day. Quick hits are
            headline-only and free.
          </p>

          <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-medium text-ink-soft">
                Let the model choose the cards
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-faint">
                One extra call ranks the shortlist against what you have saved.
                Off, the order comes from your taste profile alone.
              </span>
            </div>
            <Switch
              checked={form?.digest_rerank !== "off"}
              title={
                form?.digest_rerank === "off"
                  ? "Off — click to let the model rank"
                  : "On — click to use the taste profile alone"
              }
              onClick={() =>
                setField(
                  "digest_rerank",
                  form?.digest_rerank === "off" ? "on" : "off"
                )
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {field("Daily at", "digest_daily_at", "08:00")}
            <label className="block">
              <span className="text-[13px] font-medium text-ink-soft">
                Weekly on
              </span>
              <div className="mt-1.5 flex gap-2">
                <select
                  value={weeklyDay}
                  onChange={(event) =>
                    setField(
                      "digest_weekly_at",
                      `${event.target.value} ${weeklyTime}`
                    )
                  }
                  className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-clay"
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
                <input
                  value={weeklyTime}
                  onChange={(event) =>
                    setField(
                      "digest_weekly_at",
                      `${weeklyDay} ${event.target.value}`
                    )
                  }
                  placeholder="19:00"
                  className="w-24 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
                />
              </div>
            </label>
          </div>
          {field(
            "Time zone",
            "digest_tz",
            "Europe/Moscow",
            "An IANA name. A container's clock is UTC unless you say otherwise."
          )}

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
