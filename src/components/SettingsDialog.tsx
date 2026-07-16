"use client";

import { useEffect, useState } from "react";
import { type FeedDto } from "@/lib/types";

export interface SettingsForm {
  omnivore_url: string;
  omnivore_api_key: string;
  marreta_url: string;
  archive_url: string;
  direct_domains: string;
  archive_domains: string;
}

export type Route = "marreta" | "direct" | "archive";

export const ROUTES: Array<{ value: Route; label: string }> = [
  { value: "marreta", label: "Marreta" },
  { value: "direct", label: "Direct" },
  { value: "archive", label: "Archive" },
];

export function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
}

export function feedDomain(feed: FeedDto): string | null {
  try {
    return new URL(feed.site_url ?? feed.url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then(setForm);
    fetch("/api/feeds")
      .then((response) => response.json())
      .then(setFeeds);
  }, []);

  function routeFor(domain: string): Route {
    if (!form) return "marreta";
    if (parseList(form.direct_domains).includes(domain)) return "direct";
    if (parseList(form.archive_domains).includes(domain)) return "archive";
    return "marreta";
  }

  function setRoute(domain: string, route: Route) {
    setForm((prev) => {
      if (!prev) return prev;
      const direct = parseList(prev.direct_domains).filter(
        (entry) => entry !== domain
      );
      const archive = parseList(prev.archive_domains).filter(
        (entry) => entry !== domain
      );
      if (route === "direct") direct.push(domain);
      if (route === "archive") archive.push(domain);
      return {
        ...prev,
        direct_domains: direct.join(", "),
        archive_domains: archive.join(", "),
      };
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
        {hint && (
          <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span>
        )}
      </label>
    );
  }

  const feedsWithDomains = feeds
    .map((feed) => ({ feed, domain: feedDomain(feed) }))
    .filter((entry): entry is { feed: FeedDto; domain: string } =>
      Boolean(entry.domain)
    );

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
          <p className="text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
            How articles open
          </p>
          {feedsWithDomains.length > 0 && (
            <div className="space-y-2">
              {feedsWithDomains.map(({ feed, domain }) => (
                <div
                  key={feed.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span
                    className="min-w-0 truncate text-sm text-ink"
                    title={domain}
                  >
                    {feed.title}
                  </span>
                  <div className="flex shrink-0 rounded-full border border-line p-0.5">
                    {ROUTES.map((route) => (
                      <button
                        key={route.value}
                        type="button"
                        onClick={() => setRoute(domain, route.value)}
                        className={`rounded-full px-2.5 py-1 text-[12px] transition ${
                          routeFor(domain) === route.value
                            ? "bg-clay text-white"
                            : "text-ink-faint hover:text-ink"
                        }`}
                      >
                        {route.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[12px] text-ink-faint">
                Marreta strips paywalls, Direct opens the original site,
                Archive shows the latest web-archive snapshot.
              </p>
            </div>
          )}
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
          {field(
            "Open directly (skip Marreta)",
            "direct_domains",
            "habr.com",
            "Comma-separated domains — edited by the switches above, extra domains welcome."
          )}
          {field(
            "Open via web archive",
            "archive_domains",
            "nytimes.com",
            "Domains Marreta can't fetch."
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
