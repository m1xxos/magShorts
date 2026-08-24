"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type FeedDto,
  type FolderDto,
  type SettingsForm,
  timeAgo,
} from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";
import { FolderIcon, Sidebar } from "./Sidebar";
import { AddFeedDialog } from "./AddFeedDialog";
import { CreateFolderDialog } from "./CreateFolderDialog";
import { Menu, separator, type MenuNode } from "./ui/Menu";
import { Segmented } from "./ui/Segmented";
import { Switch } from "./ui/Switch";
import { SettingsDialog } from "./SettingsDialog";
import { Toast, useToast } from "./Toast";
import { TopBar } from "./TopBar";
import { useUser } from "@/lib/useUser";

// How a publication's articles open. Stored as two comma-separated domain
// lists in settings; anything in neither list goes through Marreta.
type Route = "marreta" | "direct" | "archive";

const ROUTES: Array<{ value: Route; label: string }> = [
  { value: "marreta", label: "Marreta" },
  { value: "direct", label: "Direct" },
  { value: "archive", label: "Archive" },
];

function parseList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
}

// Consecutive failed refreshes before a subscription is called out. At one
// attempt every ten minutes this is an hour of silence.
const FAILING_AFTER = 6;

function feedDomain(feed: FeedDto): string | null {
  try {
    return new URL(feed.site_url ?? feed.url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function SourcesManager() {
  const user = useUser();
  const { toast, showToast } = useToast();
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [settings, setSettings] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  // Only so the rail's Read later row can carry its count, the same number it
  // shows on every other page.
  const [readingCount, setReadingCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [addUrl, setAddUrl] = useState("");
  const [addFolder, setAddFolder] = useState<string>("");
  const [addBusy, setAddBusy] = useState(false);
  const [renamingFeed, setRenamingFeed] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [filter, setFilter] = useState("");
  const [retrying, setRetrying] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  function toggleCollapsed(folderId: number) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  const reload = useCallback(async () => {
    const [feedsRes, foldersRes, settingsRes, savedRes] = await Promise.all([
      fetch("/api/feeds"),
      fetch("/api/folders"),
      fetch("/api/settings"),
      fetch("/api/reading-list"),
    ]);
    setFeeds(await feedsRes.json());
    setFolders(await foldersRes.json());
    setSettings(await settingsRes.json());
    const saved = await savedRes.json();
    setReadingCount(Array.isArray(saved) ? saved.length : 0);
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

  // The gentler alternative to unsubscribing: the publication keeps its
  // recent articles and moves to the Discover catalog, where it can be picked
  // up again, instead of being deleted outright.
  async function moveToDiscover(feed: FeedDto) {
    await fetch(`/api/feeds/${feed.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscribed: false }),
    });
    showToast(`${feed.title} moved to Discover`);
    reload();
  }

  async function moveFolderToDiscover(folder: FolderDto) {
    const inFolder = feeds.filter((feed) => feed.folder_id === folder.id);
    if (inFolder.length === 0) return;
    if (
      !confirm(
        `Move all ${inFolder.length} publications in “${folder.name}” to Discover? ` +
          "They stay in the catalog and keep their recent articles."
      )
    ) {
      return;
    }
    for (const feed of inFolder) {
      await fetch(`/api/feeds/${feed.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscribed: false }),
      });
    }
    showToast(`${inFolder.length} publications moved to Discover`);
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

  // Fetch this feed now, past the fifteen-minute staleness gate the background
  // refresh uses. A feed that is failing keeps its old last_fetched_at, so
  // without the force flag a retry pressed a minute after a failure would
  // quietly do nothing at all.
  async function retryFeed(feed: FeedDto) {
    setRetrying(feed.id);
    try {
      const response = await fetch(`/api/feeds/${feed.id}/refresh`, {
        method: "POST",
      });
      if (!response.ok) {
        showToast(`${feed.title} still isn’t answering`, true);
        return;
      }
      const fresh: FeedDto = await response.json();
      setFeeds((previous) =>
        previous.map((entry) => (entry.id === feed.id ? { ...entry, ...fresh } : entry))
      );
      showToast(
        fresh.failures === 0
          ? `${feed.title} is answering again`
          : `${feed.title} still isn’t answering`,
        fresh.failures !== 0
      );
    } finally {
      setRetrying(null);
    }
  }

  function feedRow(feed: FeedDto) {
    const domain = feedDomain(feed);
    const failing = feed.failures >= FAILING_AFTER;
    const perWeek = feed.recent_articles / 4;
    const rate =
      perWeek >= 1
        ? `${Math.round(perWeek)} / week`
        : feed.recent_articles > 0
          ? `${feed.recent_articles} this month`
          : "quiet this month";

    return (
      <li
        key={feed.id}
        className={`flex items-center gap-3 rounded-2xl border bg-paper-raised px-4 py-3 ${
          failing ? "border-clay/50" : "border-line"
        }`}
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
              className="w-full rounded-lg border border-clay bg-paper px-2 py-1 text-sm text-ink outline-none"
            />
          ) : (
            <p
              className={`truncate text-sm font-medium text-ink pointer-coarse:text-[15.5px] ${
                feed.enabled ? "" : "opacity-50"
              }`}
            >
              {feed.title}
            </p>
          )}
          <p className="mt-0.5 truncate text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
            {domain ?? feed.url}
            {failing ? (
              // The count is not the news about this feed; the silence is.
              <span className="text-clay">
                <span className="mx-1.5">·</span>
                Not answering since{" "}
                {feed.last_fetched_at
                  ? new Date(
                      feed.last_fetched_at.replace(" ", "T") + "Z"
                    ).toLocaleString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "numeric",
                      month: "short",
                    })
                  : "the beginning"}
              </span>
            ) : (
              <>
                <span className="mx-1.5">·</span>
                {feed.article_count} article{feed.article_count === 1 ? "" : "s"}
                <span className="mx-1.5">·</span>
                {rate}
              </>
            )}
          </p>
        </div>

        {failing && (
          <button
            onClick={() => retryFeed(feed)}
            disabled={retrying === feed.id}
            className="shrink-0 rounded-full border border-clay px-3 py-1.5 text-[12px] text-clay transition hover:bg-clay-soft disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-4"
          >
            {retrying === feed.id ? "Trying…" : "Retry now"}
          </button>
        )}

        {/* A label, not a control: the control is in the menu, where there is
            room to say which domain it applies to. */}
        {domain && !failing && (
          <span className="shrink-0 rounded-full bg-paper-sunken px-2.5 py-1 text-[11.5px] text-ink-soft">
            {ROUTES.find((route) => route.value === routeFor(domain))?.label}
          </span>
        )}

        <Switch
          checked={Boolean(feed.enabled)}
          label={feed.enabled ? "On" : "Off"}
          title={feed.enabled ? "Turn off this feed" : "Turn on this feed"}
          onClick={() => patchFeed(feed, { enabled: !feed.enabled })}
        />

        <Menu
          items={[
            { label: "Rename…", onSelect: () => startRename(feed) },
            {
              kind: "custom",
              key: "folder",
              label: "Folder",
              render: (
                <select
                  value={feed.folder_id ?? ""}
                  onChange={(event) =>
                    patchFeed(feed, {
                      folder_id: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-clay"
                >
                  <option value="">No folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              ),
            },
            ...(domain
              ? ([
                  separator("route"),
                  {
                    kind: "custom" as const,
                    key: "route",
                    // Named after the domain, because that is what it changes.
                    // Two feeds on one host share a route, and a control that
                    // says "its articles" hides that.
                    label: `How ${domain} opens`,
                    render: (
                      <>
                        <Segmented
                          options={ROUTES.map((route) => ({
                            value: route.value,
                            label: route.label,
                          }))}
                          value={routeFor(domain)}
                          onChange={(route) => setRoute(domain, route)}
                          tone="clay"
                          className="w-full"
                        />
                        {sharingDomain(feed, domain) > 0 && (
                          <p className="mt-1.5 text-[11.5px] text-ink-faint">
                            Also affects {sharingDomain(feed, domain)} other
                            source{sharingDomain(feed, domain) === 1 ? "" : "s"}{" "}
                            on this domain.
                          </p>
                        )}
                      </>
                    ),
                  },
                ] as MenuNode[])
              : []),
            separator("leave"),
            {
              label: "Retire to Discover",
              hint: "Keeps its articles, stops the subscription",
              onSelect: () => moveToDiscover(feed),
            },
            {
              label: "Unsubscribe and delete archive",
              destructive: true,
              onSelect: () => removeFeed(feed),
            },
          ]}
        />
      </li>
    );
  }

  // How many other subscriptions this route change would also move.
  function sharingDomain(feed: FeedDto, domain: string): number {
    return feeds.filter(
      (other) => other.id !== feed.id && feedDomain(other) === domain
    ).length;
  }

  function folderGroup(
    folder: FolderDto | null,
    inFolder: FeedDto[]
  ): React.ReactNode {
    const key = folder ? `folder-${folder.id}` : "loose";
    const open = folder ? !collapsed.has(folder.id) : true;
    return (
      <section key={key} className="mt-6">
        <div className="flex items-center gap-3 px-1 pb-2">
          {folder ? (
            <button
              onClick={() => toggleCollapsed(folder.id)}
              title={open ? "Collapse" : "Expand"}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <span className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>
                ▶
              </span>
            </button>
          ) : (
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint">
              <FolderIcon size={13} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium tracking-[0.06em] text-ink-soft uppercase">
              {folder ? folder.name : "Not in a folder"}
            </p>
            <p className="text-[12px] text-ink-faint">
              {inFolder.length} source{inFolder.length === 1 ? "" : "s"}
              {!folder && " — always counted everywhere"}
            </p>
          </div>

          {folder && (
            <>
              {/* Switches, not chips. These two toggles are the only place in
                  the app that says what a folder is for, and the sidebar has
                  stopped carrying them. */}
              <Switch
                checked={Boolean(folder.include_in_main)}
                label="For you"
                title={
                  folder.include_in_main
                    ? "Feeds your For you picks — click to exclude"
                    : "Excluded from For you — click to include"
                }
                onClick={() =>
                  patchFolder(folder, { include_in_main: !folder.include_in_main })
                }
              />
              <Switch
                checked={Boolean(folder.include_in_digest)}
                label="Digest"
                title={
                  folder.include_in_digest
                    ? "In the digest — click to exclude"
                    : "Excluded from the digest — click to include"
                }
                onClick={() =>
                  patchFolder(folder, {
                    include_in_digest: !folder.include_in_digest,
                  })
                }
              />
              <Menu
                items={[
                  {
                    label: "Rename…",
                    onSelect: () => {
                      const name = window.prompt("Folder name", folder.name);
                      if (name?.trim()) patchFolder(folder, { name: name.trim() });
                    },
                  },
                  { label: "New folder…", onSelect: () => setFolderDialogOpen(true) },
                  separator("folder-danger"),
                  {
                    label: "Move all to Discover",
                    onSelect: () => moveFolderToDiscover(folder),
                  },
                  {
                    label: "Delete folder",
                    hint: "Its feeds stay subscribed and move out",
                    destructive: true,
                    onSelect: () => removeFolder(folder),
                  },
                ]}
              />
            </>
          )}
        </div>

        {open &&
          (inFolder.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-faint">
              Nothing here yet.
            </p>
          ) : (
            <ul className="space-y-2">{inFolder.map(feedRow)}</ul>
          ))}
      </section>
    );
  }

  const rootFeeds = feeds.filter((feed) => feed.folder_id === null);
  const matching = (feed: FeedDto) =>
    filter.trim() === "" ||
    `${feed.title} ${feed.url}`.toLowerCase().includes(filter.trim().toLowerCase());
  const failingFeeds = feeds.filter((feed) => feed.failures >= FAILING_AFTER);
  const refreshedAt = feeds
    .map((feed) => feed.last_fetched_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  return (
    <div className="min-h-screen">
      <TopBar username={user?.username} />
      <div className="flex">
        <Sidebar
          feeds={feeds}
          folders={folders}
          selection={null}
          readingCount={readingCount}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="mx-auto min-w-0 max-w-[900px] flex-1 px-5 py-8 md:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-serif text-3xl text-ink">Sources</h1>
              <p className="mt-1 text-[13px] text-ink-faint pointer-coarse:text-[14.5px]">
                {feeds.length} publication{feeds.length === 1 ? "" : "s"}
                <span className="mx-1.5">·</span>
                {folders.length} folder{folders.length === 1 ? "" : "s"}
                {refreshedAt && (
                  <>
                    <span className="mx-1.5">·</span>
                    refreshed{" "}
                    {timeAgo(refreshedAt.replace(" ", "T") + "Z") || "just now"}
                  </>
                )}
              </p>
            </div>
            {/* Kept below lg, where the rail is not rendered. */}
            <Link href="/" className="shrink-0 text-sm text-clay hover:underline lg:hidden">
              ← Back to feed
            </Link>
          </div>

          {/* One banner naming the feeds that have gone quiet, because grey
              text mid-list is not something anyone scrolls to. */}
          {failingFeeds.length > 0 && (
            <div className="mt-5 rounded-2xl border border-clay/50 bg-clay-soft/40 px-4 py-3 text-[13px] text-ink-soft">
              <strong className="font-medium text-ink">
                {failingFeeds.length === 1
                  ? `${failingFeeds[0].title} is not answering.`
                  : `${failingFeeds.length} sources are not answering.`}
              </strong>{" "}
              {failingFeeds.length > 1 && (
                <>{failingFeeds.map((feed) => feed.title).join(", ")}. </>
              )}
              Retry from the row, or leave it — a subscription is never turned
              off behind your back.
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter your sources"
              className="min-w-[220px] flex-1 rounded-xl border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
            />
            {/* The add field is inline on a mouse and a sheet on a finger,
                where the keyboard would otherwise cover the list it is
                adding to. */}
            <form onSubmit={addFeed} className="hidden items-center gap-2.5 lg:flex">
              <input
                type="url"
                value={addUrl}
                onChange={(event) => setAddUrl(event.target.value)}
                placeholder="https://example.com or its feed URL"
                className="w-[300px] rounded-xl border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay"
              />
              <select
                value={addFolder}
                onChange={(event) => setAddFolder(event.target.value)}
                className="rounded-xl border border-line bg-paper-raised px-3 py-2.5 text-sm text-ink outline-none focus:border-clay"
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
                className="shrink-0 rounded-full bg-clay px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-60"
              >
                {addBusy ? "Finding…" : "Add a source"}
              </button>
            </form>
            <button
              onClick={() => setAddOpen(true)}
              className="shrink-0 rounded-full bg-clay px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-95 lg:hidden pointer-coarse:min-h-12"
            >
              Add a source
            </button>
          </div>

          {loading ? (
            <p className="py-20 text-center text-ink-faint">Loading…</p>
          ) : (
            <>
              {folders.map((folder) =>
                folderGroup(
                  folder,
                  feeds.filter(
                    (feed) => feed.folder_id === folder.id && matching(feed)
                  )
                )
              )}
              {folderGroup(null, rootFeeds.filter(matching))}
            </>
          )}
        </main>
      </div>

      {addOpen && (
        <AddFeedDialog
          onClose={() => setAddOpen(false)}
          onAdded={() => reload()}
        />
      )}
      {folderDialogOpen && (
        <CreateFolderDialog
          onClose={() => setFolderDialogOpen(false)}
          onCreated={() => reload()}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(message) => showToast(message)}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
