"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type MouseEvent } from "react";
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

export function CompassIcon({ size = 14 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" />
    </svg>
  );
}

export function ChartIcon({ size = 14 }: { size?: number }) {
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
      <path d="M6 20v-6" />
      <path d="M12 20V6" />
      <path d="M18 20v-9" />
    </svg>
  );
}

export function CalendarIcon({ size = 14 }: { size?: number }) {
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
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
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

// A row in one of the two pinned zones. Three of these name the parts of the
// app that are not a list of feeds, and until this pass none of them could say
// you were standing on it: Digest, Read later and Discover were plain links
// with no active state anywhere in the component.
function SectionRow({
  href,
  icon,
  label,
  active,
  trailing,
  onClick,
  muted = false,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  trailing?: React.ReactNode;
  onClick?: () => void;
  // The footer rows. They are destinations, not the reading you came for, and
  // giving them the same tinted circle as Digest is why nothing on the old rail
  // read as primary.
  muted?: boolean;
}) {
  const inner = (
    <>
      {active && (
        <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-clay" />
      )}
      <span
        className={
          muted
            ? "inline-flex h-7 w-7 items-center justify-center text-ink-faint"
            : `inline-flex h-7 w-7 items-center justify-center rounded-full ${
                active ? "bg-clay text-white" : "bg-clay-soft text-clay"
              }`
        }
      >
        {icon}
      </span>
      {label}
      {trailing}
    </>
  );
  const className = `relative flex items-center gap-3 rounded-xl px-3 py-[9px] text-left text-[14.5px] transition pointer-coarse:py-3 ${
    active
      ? "bg-paper-sunken font-medium text-ink"
      : `${muted ? "text-ink-faint" : "text-ink-soft"} hover:bg-paper-sunken/60`
  }`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

function FeedRow({
  feed,
  selected,
  onSelect,
}: {
  feed: FeedDto;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left transition pointer-coarse:py-2.5 ${
        selected ? "bg-paper-sunken" : "hover:bg-paper-sunken"
      }`}
    >
      {selected && (
        <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-clay" />
      )}
      <FeedAvatar
        feedId={feed.id}
        title={feed.title}
        siteUrl={feed.site_url ?? feed.url}
      />
      <span
        className={`truncate text-[14.5px] ${
          selected ? "font-medium text-ink" : "text-ink-soft"
        }`}
      >
        {feed.title}
      </span>
      {/* A word, not a filter. `opacity-40 grayscale` reads as a row that is
          still loading rather than one that has been switched off. */}
      {!feed.enabled && (
        <span className="ml-auto shrink-0 text-[11.5px] text-ink-faint">
          off
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  feeds,
  folders,
  selection,
  readingCount,
  onSelect,
  onOpenSettings,
  variant = "rail",
  onNavigate,
}: {
  feeds: FeedDto[];
  folders: FolderDto[];
  selection: Selection | null;
  readingCount: number;
  // "sheet" is the same rail without its own sticky column, for the narrow
  // screens where there is nowhere to stand one.
  variant?: "rail" | "sheet";
  // Lets the sheet close itself once you have gone somewhere.
  onNavigate?: () => void;
  // Omitted on pages other than the home grid: there the sidebar is pure
  // navigation, and selecting a feed goes home with the choice in the URL
  // rather than mutating a page that has no grid to update.
  onSelect?: (selection: Selection) => void;
  onOpenSettings?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Either update the grid in place, or leave for it.
  const select = (next: Selection) => {
    onNavigate?.();
    if (onSelect) return onSelect(next);
    const query =
      next.kind === "feed"
        ? `?feed=${next.feedId}`
        : next.kind === "folder"
          ? `?folder=${next.folderId}`
          : `?view=${next.kind}`;
    router.push(`/${query}`);
  };
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
  const [digestReady, setDigestReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem("ms_open_folders") ?? "[]",
      );
      if (Array.isArray(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
        setOpenFolders(new Set(saved.filter((id) => typeof id === "number")));
      }
    } catch {
      // Ignore a corrupt value.
    }
  }, []);

  // Is there a digest waiting that has not been opened? Deliberately its own
  // endpoint rather than /api/digest: the rail is on five pages now, and that
  // one returns the whole snapshot — every card, every blurb — to answer a
  // yes-or-no question.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const response = await fetch("/api/digest/status");
        if (!response.ok) return;
        const body = await response.json();
        const seen = window.localStorage.getItem("ms_digest_seen");
        if (!cancelled) {
          setDigestReady(Boolean(body.ready) && seen !== body.period_key);
        }
      } catch {
        // A marker is not worth reporting a failure over.
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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

  // Three zones, not one scrolling column. The rail used to scroll as a whole,
  // so with twenty feeds Digest left the viewport and the Settings row sat
  // below the bottom of a long list — the two things you reach for most were
  // the two least likely to be on screen.
  //
  // Held back to lg as a column: on a portrait tablet the 288px rail costs a
  // third of the window. Below that it is the same rows in a sheet — for a
  // long time it was simply absent, and with it went the only way to reach
  // the digest, Discover, Your reading or the settings at all.
  const Frame = variant === "sheet" ? "div" : "aside";
  return (
    <Frame
      className={
        variant === "sheet"
          ? "flex min-h-0 flex-1 flex-col"
          : "sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 flex-col lg:flex"
      }
      // One handler rather than a callback threaded through every row: in a
      // sheet, everything in here is a destination and reaching one is the
      // cue to close. Everything except expanding a folder, which is how you
      // find the destination in the first place.
      onClick={
        onNavigate
          ? (event: MouseEvent) => {
              if (!(event.target as HTMLElement).closest("[data-stay]")) {
                onNavigate();
              }
            }
          : undefined
      }
    >
      <div className="flex shrink-0 flex-col gap-0.5 border-b border-line px-3 py-4">
        <SectionRow
          href="/digest"
          icon={<CalendarIcon size={14} />}
          label="Digest"
          active={pathname === "/digest"}
          trailing={
            digestReady ? (
              <span className="ml-auto rounded-full bg-clay-soft px-2 py-0.5 text-[11px] font-medium text-clay">
                today
              </span>
            ) : undefined
          }
        />
        <SectionRow
          href="/reading-list"
          icon={<BookmarkIcon size={14} />}
          label="Read later"
          active={pathname === "/reading-list"}
          trailing={
            readingCount > 0 ? (
              <span className="ml-auto rounded-full bg-paper-sunken px-2 py-0.5 text-[12px] tabular-nums text-ink-faint">
                {readingCount}
              </span>
            ) : undefined
          }
        />
        <SectionRow
          href="/discover"
          icon={<CompassIcon size={14} />}
          label="Discover"
          active={pathname === "/discover"}
        />
        <SectionRow
          href="/stats"
          icon={<ChartIcon size={14} />}
          label="Your reading"
          active={pathname === "/stats"}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
          Subscriptions
        </p>

        <div className="flex flex-col gap-0.5">
          <SectionRow
            icon={<SparkleIcon size={14} />}
            label="For you"
            active={selection?.kind === "forYou"}
            onClick={() => select({ kind: "forYou" })}
          />
          <SectionRow
            icon={<span className="text-[13px]">∗</span>}
            label="All publications"
            active={selection?.kind === "all"}
            onClick={() => select({ kind: "all" })}
            muted
          />

          {rootFeeds.map((feed) => (
            <FeedRow
              key={feed.id}
              feed={feed}
              selected={
                selection?.kind === "feed" && selection.feedId === feed.id
              }
              onSelect={() => select({ kind: "feed", feedId: feed.id })}
            />
          ))}

          {folders.map((folder) => {
            const folderFeeds = feeds.filter(
              (feed) => feed.folder_id === folder.id,
            );
            const open = openFolders.has(folder.id);
            const selected =
              selection?.kind === "folder" && selection.folderId === folder.id;
            return (
              <div key={folder.id} className="mt-1">
                <div
                  className={`relative flex items-center gap-2 rounded-xl px-3 py-2 transition ${
                    selected ? "bg-paper-sunken" : "hover:bg-paper-sunken/60"
                  }`}
                >
                  {selected && (
                    <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-clay" />
                  )}
                  <button
                    title={open ? "Collapse folder" : "Expand folder"}
                    data-stay
                    onClick={() => toggleOpen(folder.id)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
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
                    onClick={() =>
                      select({ kind: "folder", folderId: folder.id })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-ink-faint">
                      <FolderIcon size={13} />
                    </span>
                    <span
                      className={`truncate text-[14.5px] ${
                        selected ? "font-medium text-ink" : "text-ink-soft"
                      }`}
                    >
                      {folder.name}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                      {folderFeeds.length}
                    </span>
                  </button>
                  {/* Was a switch whose meaning lived in a title attribute. A
                      nav rail should report that state, not be where you change
                      it — Manage sources carries the switch, with a label. */}
                  {!folder.include_in_main && (
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      not in For you
                    </span>
                  )}
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
                            selection?.kind === "feed" &&
                            selection.feedId === feed.id
                          }
                          onSelect={() =>
                            select({ kind: "feed", feedId: feed.id })
                          }
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-line px-3 py-4">
        <SectionRow
          href="/sources"
          icon={<FolderIcon size={13} />}
          label="Manage sources"
          active={pathname === "/sources"}
          muted
        />
        {onOpenSettings && (
          <SectionRow
            icon={<GearIcon />}
            label="Settings"
            active={false}
            onClick={onOpenSettings}
            muted
          />
        )}
      </div>
    </Frame>
  );
}

function GearIcon() {
  return (
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
  );
}
