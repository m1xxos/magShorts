"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type FeedDto, type FolderDto } from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";
import { FolderIcon } from "./Sidebar";
import {
  ROUTES,
  type Route,
  type SettingsForm,
  feedDomain,
  parseList,
} from "./SettingsDialog";
import { Toast, useToast } from "./Toast";
import { TopBar } from "./TopBar";
import { useUser } from "@/lib/useUser";

export function SourcesManager() {
  const user = useUser();
  const { toast, showToast } = useToast();
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);

  const [addUrl, setAddUrl] = useState("");
  const [addFolder, setAddFolder] = useState<string>("");
  const [addBusy, setAddBusy] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFeed, setRenamingFeed] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const reload = useCallback(async () => {
    const [feedsRes, foldersRes, settingsRes] = await Promise.all([
      fetch("/api/feeds"),
      fetch("/api/folders"),
      fetch("/api/settings"),
    ]);
    setFeeds(await feedsRes.json());
    setFolders(await foldersRes.json());
    setSettings(await settingsRes.json());
  }, []);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    reload().finally(() => setLoading(false));
  }, [user, reload]);

  async function addFeed(event: React.FormEvent) {
    event.preventDefault();
    setAddBusy(true);
    try {
      const response = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: addUrl,
          folder_id: addFolder ? Number(addFolder) : null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(body?.error ?? "Could not add this source", true);
        return;
      }
      setAddUrl("");
      showToast(`Subscribed to ${body?.title ?? "the feed"}`);
      reload();
    } finally {
      setAddBusy(false);
    }
  }

  async function createFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, include_in_main: false }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      showToast(body?.error ?? "Could not create the folder", true);
      return;
    }
    setNewFolderName("");
    showToast(`Folder “${name}” created`);
    reload();
  }

  async function patchFolder(folder: FolderDto, patch: Record<string, unknown>) {
    await fetch(`/api/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    reload();
  }

  async function removeFolder(folder: FolderDto) {
    if (
      !confirm(
        `Delete folder “${folder.name}”? Its feeds stay subscribed and move out of the folder.`
      )
    ) {
      return;
    }
    await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
    showToast(`Folder “${folder.name}” deleted`);
    reload();
  }

  async function patchFeed(feed: FeedDto, patch: Record<string, unknown>) {
    const response = await fetch(`/api/feeds/${feed.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      showToast(body?.error ?? "Could not update the feed", true);
    }
    reload();
  }

  async function removeFeed(feed: FeedDto) {
    if (!confirm(`Unsubscribe from “${feed.title}”?`)) return;
    await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    showToast(`Unsubscribed from ${feed.title}`);
    reload();
  }

  function routeFor(domain: string): Route {
    if (!settings) return "marreta";
    if (parseList(settings.direct_domains).includes(domain)) return "direct";
    if (parseList(settings.archive_domains).includes(domain)) return "archive";
    return "marreta";
  }

  async function setRoute(domain: string, route: Route) {
    if (!settings) return;
    const direct = parseList(settings.direct_domains).filter(
      (entry) => entry !== domain
    );
    const archive = parseList(settings.archive_domains).filter(
      (entry) => entry !== domain
    );
    if (route === "direct") direct.push(domain);
    if (route === "archive") archive.push(domain);
    const next = {
      ...settings,
      direct_domains: direct.join(", "),
      archive_domains: archive.join(", "),
    };
    setSettings(next);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  function startRename(feed: FeedDto) {
    setRenamingFeed(feed.id);
    setRenameValue(feed.title);
  }

  async function finishRename(feed: FeedDto) {
    setRenamingFeed(null);
    const title = renameValue.trim();
    if (!title || title === feed.title) return;
    await patchFeed(feed, { title });
  }

  function feedRow(feed: FeedDto) {
    const domain = feedDomain(feed);
    return (
      <li
        key={feed.id}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-paper-raised px-4 py-3"
      >
        <FeedAvatar
          feedId={feed.id}
          title={feed.title}
          siteUrl={feed.site_url ?? feed.url}
        />
        <div className="min-w-0 flex-1">
          {renamingFeed === feed.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => finishRename(feed)}
              onKeyDown={(event) => {
                if (event.key === "Enter") finishRename(feed);
                if (event.key === "Escape") setRenamingFeed(null);
              }}
              className="w-full max-w-xs rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-clay"
            />
          ) : (
            <button
              onClick={() => startRename(feed)}
              title="Rename"
              className={`block max-w-full truncate text-left text-sm text-ink hover:text-clay ${
                feed.enabled ? "" : "opacity-50"
              }`}
            >
              {feed.title}
            </button>
          )}
          <p className="truncate text-[12px] text-ink-faint">
            {domain ?? feed.url} · {feed.article_count} article
            {feed.article_count === 1 ? "" : "s"}
          </p>
        </div>

        {domain && (
          <div className="flex shrink-0 rounded-full border border-line p-0.5">
            {ROUTES.map((route) => (
              <button
                key={route.value}
                type="button"
                title={`Open ${feed.title} articles via ${route.label}`}
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
        )}

        <select
          value={feed.folder_id ?? ""}
          onChange={(event) =>
            patchFeed(feed, {
              folder_id: event.target.value ? Number(event.target.value) : null,
            })
          }
          title="Move to a folder"
          className="shrink-0 rounded-lg border border-line bg-paper px-2 py-1.5 text-[12px] text-ink-soft outline-none focus:border-clay"
        >
          <option value="">No folder</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>

        <button
          role="switch"
          aria-checked={Boolean(feed.enabled)}
          title={feed.enabled ? "Turn off this feed" : "Turn on this feed"}
          onClick={() => patchFeed(feed, { enabled: !feed.enabled })}
          className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
            feed.enabled ? "bg-clay" : "bg-line"
          }`}
        >
          <span
            className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
              feed.enabled ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>

        <button
          title={`Unsubscribe from ${feed.title}`}
          onClick={() => removeFeed(feed)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-line hover:text-ink"
        >
          ×
        </button>
      </li>
    );
  }

  const rootFeeds = feeds.filter((feed) => feed.folder_id === null);

  return (
    <div className="min-h-screen">
      <TopBar username={user?.username} />
      <main className="mx-auto max-w-4xl px-5 py-8 md:px-8">
        <div className="flex items-baseline justify-between">
          <h1 className="font-serif text-3xl text-ink">Sources</h1>
          <Link href="/" className="text-sm text-clay hover:underline">
            ← Back to feed
          </Link>
        </div>

        {/* Add a source */}
        <form
          onSubmit={addFeed}
          className="mt-6 rounded-2xl border border-line bg-paper-raised p-5"
        >
          <h2 className="font-serif text-lg text-ink">Add a source</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            Paste an RSS/Atom feed URL — or just the site or blog address, the
            feed will be discovered automatically.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="url"
              required
              value={addUrl}
              onChange={(event) => setAddUrl(event.target.value)}
              placeholder="https://example.com or https://example.com/feed.xml"
              className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
            />
            <select
              value={addFolder}
              onChange={(event) => setAddFolder(event.target.value)}
              className="rounded-xl border border-line bg-paper px-3 py-2.5 text-sm text-ink-soft outline-none focus:border-clay"
            >
              <option value="">No folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={addBusy}
              className="rounded-xl bg-clay px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {addBusy ? "Finding feed…" : "Subscribe"}
            </button>
          </div>
        </form>

        {/* Folders */}
        <section className="mt-8">
          <h2 className="font-serif text-lg text-ink">Folders</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            The switch controls whether a folder’s articles feed your For you
            picks. All publications always shows everything; every folder has
            its own view in the sidebar and its own Shorts deck.
          </p>
          <ul className="mt-3 space-y-2">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper-raised px-4 py-3"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-paper-sunken text-ink-soft">
                  <FolderIcon size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {folder.name}
                  <span className="ml-2 text-[12px] tabular-nums text-ink-faint">
                    {folder.feed_count} feed{folder.feed_count === 1 ? "" : "s"}
                  </span>
                </span>
                <button
                  onClick={() => {
                    const name = prompt("Rename folder", folder.name)?.trim();
                    if (name && name !== folder.name)
                      patchFolder(folder, { name });
                  }}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition hover:border-clay hover:text-clay"
                >
                  Rename
                </button>
                <label className="flex shrink-0 items-center gap-2 text-[12px] text-ink-faint">
                  In For you
                  <button
                    role="switch"
                    aria-checked={Boolean(folder.include_in_main)}
                    onClick={() =>
                      patchFolder(folder, {
                        include_in_main: !folder.include_in_main,
                      })
                    }
                    className={`relative h-[18px] w-8 rounded-full transition-colors ${
                      folder.include_in_main ? "bg-clay" : "bg-line"
                    }`}
                  >
                    <span
                      className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
                        folder.include_in_main ? "left-[16px]" : "left-[2px]"
                      }`}
                    />
                  </button>
                </label>
                <button
                  title={`Delete folder ${folder.name}`}
                  onClick={() => removeFolder(folder)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-line hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={createFolder} className="mt-3 flex gap-2">
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="New folder name"
              className="min-w-0 flex-1 rounded-xl border border-dashed border-line bg-paper px-4 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
            />
            <button
              type="submit"
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink-soft transition hover:border-clay hover:text-clay"
            >
              Create folder
            </button>
          </form>
        </section>

        {/* Feeds */}
        {loading ? (
          <p className="py-16 text-center text-ink-faint">Loading…</p>
        ) : (
          <>
            <section className="mt-8">
              <h2 className="font-serif text-lg text-ink">Feeds</h2>
              <p className="mt-1 text-[13px] text-ink-faint">
                Click a title to rename it. Marreta / Direct / Archive controls
                how its articles open.
              </p>
              {rootFeeds.length > 0 && (
                <ul className="mt-3 space-y-2">{rootFeeds.map(feedRow)}</ul>
              )}
            </section>
            {folders.map((folder) => {
              const folderFeeds = feeds.filter(
                (feed) => feed.folder_id === folder.id
              );
              if (folderFeeds.length === 0) return null;
              return (
                <section key={folder.id} className="mt-6">
                  <h3 className="flex items-center gap-2 text-[13px] font-medium tracking-[0.1em] text-ink-faint uppercase">
                    <FolderIcon size={12} /> {folder.name}
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {folderFeeds.map(feedRow)}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </main>
      <Toast toast={toast} />
    </div>
  );
}
