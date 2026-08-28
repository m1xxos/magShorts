"use client";

import { useEffect, useState } from "react";
import { type FolderDto, type SettingsForm } from "@/lib/types";
import { Switch } from "./ui/Switch";
import { Segmented } from "./ui/Segmented";
import { ChipRow, Chip } from "./ui/ChipRow";
import { Sheet } from "./ui/Sheet";
import { useMediaQuery } from "@/lib/useMediaQuery";

// Only these are edited here. Saving must not send the per-domain lists, or a
// dialog opened before a change in Manage sources would write stale ones back
// (the PUT handler applies whatever keys it receives).
const EDITABLE: Array<keyof SettingsForm> = [
  "default_view",
  "open_in_reader",
  "marreta_url",
  "archive_url",
  "digest_also_count",
  "digest_quick_count",
  "digest_daily_at",
  "digest_weekly_at",
  "digest_tz",
  "digest_rerank",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Tab = "reading" | "digest";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "reading", label: "Reading" },
  { value: "digest", label: "Digest" },
];

// "Sun 19:00" → ["Sun", "19:00"], tolerating whatever is in the setting.
function splitWeekly(value: string): [string, string] {
  const match = value.trim().match(/^([A-Za-z]{3})\w*\s*(\d{1,2}:\d{2})?/);
  return [match?.[1] ?? "Sun", match?.[2] ?? "19:00"];
}

// The dialog is a form with a dozen fields and three subjects, and it used to
// present them as one column with uppercase labels doing the dividing. Tabs
// make the subject the heading, which is the only thing those labels were for.
export function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  // What was loaded, so the footer can count what has actually changed rather
  // than saying "unsaved changes" from the moment the dialog opens.
  const [initial, setInitial] = useState<SettingsForm | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("reading");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Portrait: the modal becomes the screen and the rail becomes a segmented
  // control. A 196px rail beside a 380px column is most of the window.
  const narrow = useMediaQuery("(max-width: 899px)");

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then((data: SettingsForm) => {
        setForm(data);
        setInitial(data);
      });
    fetch("/api/folders")
      .then((response) => response.json())
      .then((data: FolderDto[]) => {
        if (Array.isArray(data)) setFolders(data);
      });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [weeklyDay, weeklyTime] = splitWeekly(form?.digest_weekly_at ?? "");

  // One lead card, one per "also" card, one for the three-lines panel, and one
  // more when the model is also ranking the shortlist. Quick hits are stored
  // headline-only and cost nothing — the old copy counted two calls flat and
  // never counted the ranking one, which is on by default.
  const llmCalls =
    2 +
    (Number.parseInt(form?.digest_also_count ?? "", 10) || 0) +
    (form?.digest_rerank === "off" ? 0 : 1);

  const dirty =
    form && initial
      ? EDITABLE.filter((key) => form[key] !== initial[key]).length
      : 0;

  function setField(key: keyof SettingsForm, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // Folder toggles are written straight through rather than on save: they live
  // on the folder, not in the settings blob, and the switch reading as applied
  // is the whole point of a switch. The footer says so, because a form with a
  // Save button that some controls ignore is otherwise a trap.
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

  function jumpToAdvanced() {
    setTab("reading");
    setAdvancedOpen(true);
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
          className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
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
          onChange={(event) => setField(key, event.target.value)}
          placeholder={placeholder}
          className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
        />
        {hint && (
          <span className="mt-1 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
            {hint}
          </span>
        )}
      </label>
    );
  }

  const reading = (
    <div className="space-y-5">
      <div>
        <span className="text-[13px] font-medium text-ink-soft">
          Where you land
        </span>
        <span className="mt-1 mb-2 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
          What the home page opens with.
        </span>
        {/* Chips rather than a select: these are the answer to one question and
            worth seeing at once. The list grows with folders, so it wraps. */}
        <ChipRow wrap>
          <Chip
            active={(form?.default_view ?? "") === ""}
            onClick={() => setField("default_view", "")}
          >
            All publications
          </Chip>
          <Chip
            active={form?.default_view === "forYou"}
            onClick={() => setField("default_view", "forYou")}
          >
            For you
          </Chip>
          {folders.map((folder) => (
            <Chip
              key={folder.id}
              active={form?.default_view === `folder:${folder.id}`}
              onClick={() => setField("default_view", `folder:${folder.id}`)}
            >
              {folder.name}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium text-ink-soft">
            Open articles in the reader
          </span>
          <span className="mt-0.5 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
            Off, a headline opens the publisher’s own page in a new tab, the way
            this worked before the reader existed.
          </span>
        </div>
        <Switch
          checked={form?.open_in_reader !== "off"}
          title={
            form?.open_in_reader === "off"
              ? "Off — click to open articles here"
              : "On — click to open the publisher’s page instead"
          }
          onClick={() =>
            setField(
              "open_in_reader",
              form?.open_in_reader === "off" ? "on" : "off"
            )
          }
        />
      </div>

      <div className="rounded-xl border border-line px-3 py-2.5">
        <span className="text-[13px] font-medium text-ink-soft">
          When a page won’t give up its text
        </span>
        <span className="mt-1 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
          The reader tries the page itself, then its print edition, then{" "}
          {form?.marreta_url || "Marreta"}, then each archive in turn. Which
          route a publication takes first is set per feed in{" "}
          <a href="/sources" className="text-clay hover:underline">
            Manage sources
          </a>
          .
        </span>
      </div>

      <details
        open={advancedOpen}
        onToggle={(event) =>
          setAdvancedOpen((event.target as HTMLDetailsElement).open)
        }
        className="rounded-xl border border-line px-3 py-2.5"
      >
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">
          Advanced
        </summary>
        <div className="mt-3 space-y-4">
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
            "Snapshot services, comma-separated; the article URL is appended to each. The reader tries them in order."
          )}
          {field(
            "Time zone",
            "digest_tz",
            "Europe/Moscow",
            "An IANA name. A container’s clock is UTC unless you say otherwise."
          )}
        </div>
      </details>
    </div>
  );

  const digest = (
    <div className="space-y-5">
      <div>
        <span className="text-[13px] font-medium text-ink-soft">Sources</span>
        <span className="mt-1 mb-2 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
          Which folders the digest reads. Separate from For you — a folder can
          feed one and not the other. Feeds outside any folder always count.
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
                <span className="min-w-0 flex-1 truncate text-sm text-ink-soft pointer-coarse:text-[15.5px]">
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
      <p className="-mt-2 text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
        Quick hits are headline-only and free.
      </p>

      <div className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium text-ink-soft">
            Let the model choose the cards
          </span>
          <span className="mt-0.5 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
            One extra call ranks the shortlist against what you have saved. Off,
            the order comes from your taste profile alone.
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

      <div>
        <span className="text-[13px] font-medium text-ink-soft">
          When it is built
        </span>
        <span className="mt-1 mb-2 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
          Times are in {form?.digest_tz || "UTC"} —{" "}
          <button
            type="button"
            onClick={jumpToAdvanced}
            className="text-clay hover:underline"
          >
            change
          </button>
          .
        </span>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[13px] font-medium text-ink-soft">
              Daily at
            </span>
            <input
              type="text"
              value={form?.digest_daily_at ?? ""}
              onChange={(event) =>
                setField("digest_daily_at", event.target.value)
              }
              placeholder="08:00"
              className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
            />
          </label>
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
                className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
              >
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={weeklyTime}
                onChange={(event) =>
                  setField(
                    "digest_weekly_at",
                    `${weeklyDay} ${event.target.value}`
                  )
                }
                placeholder="19:00"
                className="w-24 rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  );


  const panel = { reading, digest }[tab];

  const header = (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-serif text-xl text-ink">
        {TABS.find((entry) => entry.value === tab)?.label}
      </h2>
      {tab === "digest" && (
        <span className="shrink-0 text-[12px] text-ink-faint">
          {llmCalls} model call{llmCalls === 1 ? "" : "s"} a day
        </span>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
      <p className="text-[12px] text-ink-faint">
        {dirty > 0
          ? `${dirty} unsaved change${dirty === 1 ? "" : "s"}`
          : "Folder switches apply immediately."}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-line px-4 py-2 text-sm text-ink-soft transition hover:border-clay hover:text-clay pointer-coarse:min-h-11 pointer-coarse:px-5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-clay px-4 py-2 text-sm text-white transition hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-5"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );

  if (narrow) {
    return (
      <Sheet open onClose={onClose} title="Settings" full>
        <form onSubmit={submit} className="flex h-full flex-col">
          <Segmented
            options={TABS}
            value={tab}
            onChange={setTab}
            size="md"
            ariaLabel="Settings sections"
            className="mb-4 w-full"
          />
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {header}
            <div className="mt-4">{panel}</div>
          </div>
          <div className="-mx-5">{footer}</div>
        </form>
      </Sheet>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[760px] overflow-hidden rounded-2xl border border-line bg-paper-raised shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit} className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <nav className="flex w-[196px] shrink-0 flex-col gap-1 border-r border-line p-4">
              <p className="px-3 pb-2 font-serif text-[17px] text-ink">
                Settings
              </p>
              {TABS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => setTab(entry.value)}
                  className={`rounded-xl px-3 py-2 text-left text-[14px] transition ${
                    tab === entry.value
                      ? "bg-paper-sunken font-medium text-ink"
                      : "text-ink-soft hover:bg-paper-sunken/60"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
              <a
                href="/sources"
                className="mt-auto px-3 text-[12px] text-ink-faint transition hover:text-clay"
              >
                How each publication opens →
              </a>
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
              {header}
              <div className="mt-4">{panel}</div>
            </div>
          </div>
          {footer}
        </form>
      </div>
    </div>
  );
}
