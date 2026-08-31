"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ReadingByDay } from "@/components/ReadingByDay";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { SourceBars } from "@/components/SourceBars";
import { StatCard } from "@/components/StatCard";
import { TopBar } from "@/components/TopBar";
import { Toast, useToast } from "@/components/Toast";
import { TopicProfile } from "@/components/TopicProfile";
import { Segmented } from "@/components/ui/Segmented";
import {
  type FeedDto,
  type FolderDto,
  type ReadingStatsDto,
  type StatsRange,
} from "@/lib/types";
import { useUser } from "@/lib/useUser";

const RANGE_KEY = "ms_stats_range";

const RANGES: Array<{ value: StatsRange; label: string; caption: string }> = [
  { value: "week", label: "Week", caption: "Last 7 days" },
  { value: "month", label: "Month", caption: "Last 30 days" },
  { value: "year", label: "Year", caption: "Last 12 months" },
];

// Hours and minutes, never a decimal hour: "6 h 12" is a length of time and
// "6.2 h" is a measurement of one.
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

// The window this range is compared against, named rather than described:
// "than the month before" is a period a reader can picture, "than the stretch
// before" is a phrase they have to decode.
const PREVIOUS: Record<StatsRange, string> = {
  week: "the week before",
  month: "the month before",
  year: "the year before",
};

function delta(
  now: number,
  before: number,
  range: StatsRange
): { note: string; tone: "good" | "attention" | "neutral" } {
  const previous = PREVIOUS[range];
  const change = now - before;
  if (before === 0) return { note: "nothing to compare with yet", tone: "neutral" };
  if (change === 0) return { note: `the same as ${previous}`, tone: "neutral" };
  const word = change > 0 ? "more" : "fewer";
  return {
    note: `${Math.abs(change)} ${word} than ${previous}`,
    tone: change > 0 ? "good" : "attention",
  };
}

export default function StatsPage() {
  const user = useUser();
  const [range, setRange] = useState<StatsRange>("month");
  const [stats, setStats] = useState<ReadingStatsDto | null>(null);
  const [loadedRange, setLoadedRange] = useState<StatsRange | null>(null);
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [readingCount, setReadingCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { toast, showToast } = useToast();

  useEffect(() => {
    const saved = window.localStorage.getItem(RANGE_KEY);
    if (saved === "week" || saved === "month" || saved === "year") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after hydration
      setRange(saved);
    }
  }, []);

  function changeRange(value: StatsRange) {
    setRange(value);
    window.localStorage.setItem(RANGE_KEY, value);
  }

  // The rail names every destination, so it needs the same feeds and folders
  // the home grid draws, plus the size of Read later for its badge.
  useEffect(() => {
    if (!user) return;
    fetch("/api/feeds")
      .then((response) => response.json())
      .then((data) => setFeeds(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/folders")
      .then((response) => response.json())
      .then((data) => setFolders(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/reading-list")
      .then((response) => response.json())
      .then((data) => setReadingCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch(`/api/stats?range=${range}`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((data: ReadingStatsDto | null) => {
        if (cancelled) return;
        setStats(data);
        setLoadedRange(range);
      });
    return () => {
      cancelled = true;
    };
  }, [user, range]);

  const loading = !user || loadedRange !== range;
  const caption = RANGES.find((option) => option.value === range)?.caption ?? "";

  const read = stats
    ? delta(stats.articles_read, stats.articles_read_before, range)
    : null;
  // Per day, which is the unit the number is actually felt in — over the days
  // the reader was here for, not over the calendar.
  const perDay = stats
    ? Math.round(stats.seconds_reading / stats.days_counted / 60)
    : 0;

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
        <main className="mx-auto min-w-0 max-w-[1080px] flex-1 px-5 py-8 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
            <div className="min-w-0">
              <h1 className="font-serif text-3xl text-ink">Your reading</h1>
              <p className="mt-2 text-sm text-ink-soft">{caption}</p>
            </div>
            <div className="flex items-center gap-3">
              <Segmented
                options={RANGES}
                value={range}
                onChange={changeRange}
                tone="clay"
                ariaLabel="How far back to count"
              />
              <Link
                href="/"
                className="shrink-0 text-sm text-clay hover:underline lg:hidden"
              >
                ← Feed
              </Link>
            </div>
          </div>

          {loading || !stats ? (
            <p className="py-24 text-center text-ink-faint">Loading…</p>
          ) : stats.articles_read === 0 && stats.streak_best === 0 ? (
            <div className="mt-7 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line py-20 text-center">
              <p className="font-serif text-xl text-ink">Nothing to count yet</p>
              <p className="max-w-md text-sm text-ink-faint">
                Read a few articles and this page fills in — what you got
                through, where it came from, and what For you is learning from
                it.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label="Articles read"
                  value={stats.articles_read}
                  note={read?.note ?? ""}
                  tone={read?.tone}
                />
                <StatCard
                  label="Time reading"
                  value={duration(stats.seconds_reading)}
                  note={
                    stats.seconds_measured > 0
                      ? `≈ ${perDay} min a day, part of it measured`
                      : `≈ ${perDay} min a day, estimated`
                  }
                />
                <StatCard
                  label="Saved · finished"
                  value={`${stats.saved} · ${stats.finished}`}
                  note={
                    stats.waiting > 0
                      ? `${stats.waiting} still waiting`
                      : "nothing left waiting"
                  }
                  tone={stats.waiting > 0 ? "attention" : "good"}
                />
                <StatCard
                  label="Reading streak"
                  value={
                    stats.streak_days === 1
                      ? "1 day"
                      : `${stats.streak_days} days`
                  }
                  note={`Best: ${stats.streak_best}`}
                />
              </div>

              <div className="mt-7 flex flex-col gap-6 lg:flex-row lg:items-start">
                <ReadingByDay buckets={stats.by_bucket} note={stats.note} />
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <SourceBars feeds={stats.by_feed} />
                  <TopicProfile
                    topics={stats.topics}
                    signalCount={stats.signal_count}
                  />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
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
