"use client";

import { useCallback, useEffect, useState } from "react";

interface CitySource {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  enabled: number;
  failures: number;
  article_count: number;
}

interface Discovery {
  added: number;
  unreachable: number;
  mismatch: number;
  additions: unknown[] | null;
}

// The local publications behind the city digest: what was found, a way to
// throw out what does not belong, and a way to add what the model missed.
//
// That last one is not a convenience. Naming a city's papers needs a language
// model, and for a town no model has heard of — which is most towns — pasting
// a URL is the only way this feature ever does anything.
export function CitySources({
  onToast,
}: {
  onToast: (message: string, error?: boolean) => void;
}) {
  const [city, setCity] = useState("");
  const [sources, setSources] = useState<CitySource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [finding, setFinding] = useState(false);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/city/sources");
      const data = await response.json();
      setCity(typeof data.city === "string" ? data.city : "");
      setSources(Array.isArray(data.sources) ? data.sources : []);
    } catch {
      // Leave whatever is on screen; the section is not worth an error state
      // of its own when the page around it already loaded.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    void load();
  }, [load]);

  // Nothing to manage and nothing to explain until a city is named.
  if (!loaded || !city) return null;

  async function find() {
    setFinding(true);
    try {
      const response = await fetch("/api/city/discover", { method: "POST" });
      const data = (await response.json()) as Discovery & { error?: string };
      if (!response.ok) {
        onToast(data.error ?? "Could not look for publications", true);
        return;
      }
      // additions: null means nothing was tried, which is a different answer
      // from tried-and-found-nothing and deserves to say so.
      if (data.additions === null) {
        onToast(
          "No language model is configured, so publications cannot be looked up. Add one by URL instead.",
          true
        );
        return;
      }
      const parts = [`${data.added} added`];
      if (data.unreachable > 0) parts.push(`${data.unreachable} with no feed`);
      if (data.mismatch > 0) parts.push(`${data.mismatch} not about the city`);
      onToast(parts.join(", "), data.added === 0);
      await load();
    } catch {
      onToast("Could not look for publications", true);
    } finally {
      setFinding(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const value = url.trim();
    if (!value || adding) return;
    setAdding(true);
    try {
      const response = await fetch("/api/city/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = await response.json();
      if (!response.ok) {
        onToast(data.error ?? "Could not add that", true);
        return;
      }
      onToast(`Added ${data.title}`);
      setUrl("");
      await load();
    } catch {
      onToast("Could not add that", true);
    } finally {
      setAdding(false);
    }
  }

  async function remove(source: CitySource) {
    const response = await fetch(`/api/city/sources/${source.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      onToast("Could not remove that", true);
      return;
    }
    onToast(`Removed ${source.title}`);
    await load();
  }

  return (
    <section className="mt-10 border-t border-line pt-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl text-ink">Local news · {city}</h2>
          <p className="mt-1.5 max-w-xl text-[13px] text-ink-soft">
            These publications feed the city digest and nothing else — they
            never appear in your feed, For you, Shorts or search, and they do
            not shape what For you learns about you.
          </p>
        </div>
        <button
          onClick={find}
          disabled={finding}
          className="shrink-0 rounded-full bg-clay px-4 py-2 text-sm text-white transition hover:brightness-95 disabled:opacity-60"
        >
          {finding ? "Looking…" : "Find publications"}
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-faint">
          None yet. Look for them, or paste one below — plenty of local
          publications have no feed to find.
        </p>
      ) : (
        <div className="mt-5 space-y-1.5">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{source.title}</p>
                <p className="truncate text-[12px] text-ink-faint">
                  {source.site_url ?? source.url}
                </p>
              </div>
              {/* A city publication is retired after three days of silence, so
                  say it is failing before it disappears. */}
              {source.failures > 0 && (
                <span className="shrink-0 text-[11px] text-clay">
                  not answering
                </span>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                {source.article_count}
              </span>
              <button
                onClick={() => remove(source)}
                title="Remove this publication and its articles"
                aria-label={`Remove ${source.title}`}
                className="shrink-0 rounded-full px-2 py-1 text-ink-faint transition hover:bg-line hover:text-ink"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="mt-3 flex gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://a-local-paper.example — a feed or just the site"
          aria-label="Add a local publication by URL"
          className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
        />
        <button
          type="submit"
          disabled={adding || !url.trim()}
          className="shrink-0 rounded-xl border border-line px-4 py-2.5 text-sm text-ink-soft transition hover:border-clay hover:text-clay disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
    </section>
  );
}
