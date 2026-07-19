"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type FeedDto, type FolderDto, type Selection } from "@/lib/types";
import { FeedAvatar } from "./FeedAvatar";
import { BookmarkIcon } from "./SwipeableCard";

export function SparkleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2l1.9 5.7a2 2 0 0 0 1.27 1.26L20.8 11l-5.63 2.04a2 2 0 0 0-1.27 1.26L12 20l-1.9-5.7a2 2 0 0 0-1.27-1.26L3.2 11l5.63-2.04a2 2 0 0 0 1.27-1.26z" />
      <path d="M19.5 15.5l.8 2.4 2.2.8-2.2.8-.8 2.4-.8-2.4-2.2-.8 2.2-.8z" />
    </svg>
  );
}

export function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
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

function FeedRow({
  feed,
  selected,
  onSelect,
  onRemove,
  onToggle,
}: {
  feed: FeedDto;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={`group relative flex items-center rounded-xl px-3 py-2 transition ${
        selected ? "bg-paper-sunken" : "hover:bg-paper-sunken"
      }`}
    >
      <button
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
          feed.enabled ? "" : "opacity-40 grayscale"
        }`}
      >
        <FeedAvatar
          feedId={feed.id}
          title={feed.title}
          siteUrl={feed.site_url ?? feed.url}
        />
        <span
          className={`truncate text-sm ${
            selected ? "font-medium text-ink" : "text-ink-soft"
          }`}
        >
          {feed.title}
        </span>
      </button>
      {/* Controls fade in over the title's tail on hover, so titles keep
          the full row width the rest of the time. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1.5 rounded-r-xl bg-gradient-to-l from-paper-sunken via-paper-sunken to-transparent pr-3 pl-10 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        <Switch
          checked={Boolean(feed.enabled)}
          title={feed.enabled ? "Turn off this feed" : "Turn on this feed"}
          onClick={onToggle}
        />
        <button
          title={`Unsubscribe from ${feed.title}`}
          onClick={onRemove}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-line hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  feeds,
  folders,
  selection,
  readingCount,
  onSelect,
  onRemove,
  onToggle,
  onToggleFolder,
  onAddClick,
  onOpenSettings,
}: {
  feeds: FeedDto[];
  folders: FolderDto[];
  selection: Selection | null;
  readingCount: number;
  onSelect: (selection: Selection) => void;
  onRemove: (feed: FeedDto) => void;
  onToggle: (feed: FeedDto) => void;
  onToggleFolder: (folder: FolderDto) => void;
  onAddClick: () => void;
  onOpenSettings: () => void;
}) {
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("ms_open_folders") ?? "[]"
      );
      if (Array.isArray(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
        setOpenFolders(new Set(saved.filter((id) => typeof id === "number")));
      }
    } catch {
      // Ignore a corrupt value.
    }
  }, []);

  function toggleOpen(folderId: number) {
    setOpenFolders((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      window.localStorage.setItem("ms_open_folders", JSON.stringify([...next]));
      return next;
    });
  }

  const rootFeeds = feeds.filter((feed) => feed.folder_id === null);

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 flex-col gap-1 overflow-y-auto px-3 py-5 md:flex">
      <Link
        href="/reading-list"
        className="mb-4 flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink-soft transition hover:bg-paper-sunken/60"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-clay-soft text-clay">
          <BookmarkIcon size={14} />
        </span>
        Read later
        {readingCount > 0 && (
          <span className="ml-auto rounded-full bg-paper-sunken px-2 py-0.5 text-[12px] tabular-nums text-ink-faint">
            {readingCount}
          </span>
        )}
      </Link>

      <p className="px-3 pb-2 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
        Subscriptions
      </p>

      <button
        onClick={() => onSelect({ kind: "forYou" })}
        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
          selection?.kind === "forYou"
            ? "bg-paper-sunken font-medium text-ink"
            : "text-ink-soft hover:bg-paper-sunken/60"
        }`}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-clay-soft text-clay">
          <SparkleIcon size={14} />
        </span>
        For you
      </button>

      <button
        onClick={() => onSelect({ kind: "all" })}
        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
          selection?.kind === "all"
            ? "bg-paper-sunken font-medium text-ink"
            : "text-ink-soft hover:bg-paper-sunken/60"
        }`}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-soft">
          ∗
        </span>
        All publications
      </button>

      {rootFeeds.map((feed) => (
        <FeedRow
          key={feed.id}
          feed={feed}
          selected={selection?.kind === "feed" && selection.feedId === feed.id}
          onSelect={() => onSelect({ kind: "feed", feedId: feed.id })}
          onRemove={() => onRemove(feed)}
          onToggle={() => onToggle(feed)}
        />
      ))}

      {folders.map((folder) => {
        const folderFeeds = feeds.filter((feed) => feed.folder_id === folder.id);
        const open = openFolders.has(folder.id);
        const selected =
          selection?.kind === "folder" && selection.folderId === folder.id;
        return (
          <div key={folder.id} className="mt-1">
            <div
              className={`group flex items-center gap-2 rounded-xl px-3 py-2 transition ${
                selected ? "bg-paper-sunken" : "hover:bg-paper-sunken/60"
              }`}
            >
              <button
                title={open ? "Collapse folder" : "Expand folder"}
                onClick={() => toggleOpen(folder.id)}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:text-ink"
              >
                <span
                  className={`text-[10px] transition-transform ${
                    open ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
              </button>
              <button
                onClick={() => onSelect({ kind: "folder", folderId: folder.id })}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-sunken text-ink-soft">
                  <FolderIcon size={13} />
                </span>
                <span
                  className={`truncate text-sm ${
                    selected ? "font-medium text-ink" : "text-ink-soft"
                  }`}
                >
                  {folder.name}
                </span>
                <span className="text-[11px] tabular-nums text-ink-faint">
                  {folderFeeds.length}
                </span>
              </button>
              <Switch
                checked={Boolean(folder.include_in_main)}
                title={
                  folder.include_in_main
                    ? "Feeds your For you picks — click to exclude"
                    : "Excluded from For you — click to include"
                }
                onClick={() => onToggleFolder(folder)}
              />
            </div>
            {open && (
              <div className="ml-2.5 border-l border-line/70 pl-1">
                {folderFeeds.length === 0 ? (
                  <p className="px-3 py-2 text-[12px] text-ink-faint">
                    No feeds here yet
                  </p>
                ) : (
                  folderFeeds.map((feed) => (
                    <FeedRow
                      key={feed.id}
                      feed={feed}
                      selected={
                        selection?.kind === "feed" && selection.feedId === feed.id
                      }
                      onSelect={() => onSelect({ kind: "feed", feedId: feed.id })}
                      onRemove={() => onRemove(feed)}
                      onToggle={() => onToggle(feed)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={onAddClick}
        className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-left text-sm text-ink-soft transition hover:border-clay hover:text-clay"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-clay-soft text-clay">
          +
        </span>
        Add publication
      </button>

      <Link
        href="/sources"
        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink-soft transition hover:bg-paper-sunken/60"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-soft">
          <FolderIcon size={13} />
        </span>
        Manage sources
      </Link>

      <button
        onClick={onOpenSettings}
        className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2 pt-4 text-left text-sm text-ink-faint transition hover:text-ink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Settings
      </button>
    </aside>
  );
}
