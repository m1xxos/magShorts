"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type ArticleDto, type FeedDto } from "@/lib/types";
import { AddFeedDialog } from "@/components/AddFeedDialog";
import { ArticleCard } from "@/components/ArticleCard";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { Toast, useToast } from "@/components/Toast";
import { TopBar } from "@/components/TopBar";

export default function HomePage() {
  const [feeds, setFeeds] = useState<FeedDto[]>([]);
  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readingCount, setReadingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();

  const loadFeeds = useCallback(async () => {
    const response = await fetch("/api/feeds");
    setFeeds(await response.json());
  }, []);

  const loadReadingCount = useCallback(async () => {
    const response = await fetch("/api/reading-list");
    const items = await response.json();
    setReadingCount(Array.isArray(items) ? items.length : 0);
  }, []);

  const loadArticles = useCallback(async (feedId: number | null) => {
    setLoading(true);
    try {
      const query = feedId ? `?feed=${feedId}` : "?mix=1";
      const response = await fetch(`/api/articles${query}`);
      setArticles(await response.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    loadFeeds();
    loadReadingCount();
  }, [loadFeeds, loadReadingCount]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch, state updates happen after await
    loadArticles(selectedFeedId);
  }, [selectedFeedId, loadArticles]);

  async function removeFeed(feed: FeedDto) {
    if (!confirm(`Unsubscribe from “${feed.title}”?`)) return;
    await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
    if (selectedFeedId === feed.id) setSelectedFeedId(null);
    else loadArticles(selectedFeedId);
    loadFeeds();
  }

  async function toggleFeed(feed: FeedDto) {
    await fetch(`/api/feeds/${feed.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !feed.enabled }),
    });
    showToast(feed.enabled ? `${feed.title} paused` : `${feed.title} resumed`);
    loadFeeds();
    loadArticles(selectedFeedId);
  }

  return (
    <div className="min-h-screen">
      <TopBar selectedFeedId={selectedFeedId} />
      <div className="mx-auto flex max-w-[1500px]">
        <Sidebar
          feeds={feeds}
          selectedFeedId={selectedFeedId}
          readingCount={readingCount}
          onSelect={setSelectedFeedId}
          onRemove={removeFeed}
          onToggle={toggleFeed}
          onAddClick={() => setDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="min-w-0 flex-1 px-5 py-6 md:px-8">
          {/* Mobile feed chips */}
          <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5 md:hidden">
            <button
              onClick={() => setSelectedFeedId(null)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] ${
                selectedFeedId === null
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper-raised text-ink-soft"
              }`}
            >
              All
            </button>
            {feeds.map((feed) => (
              <button
                key={feed.id}
                onClick={() => setSelectedFeedId(feed.id)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] ${
                  selectedFeedId === feed.id
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-paper-raised text-ink-soft"
                }`}
              >
                {feed.title}
              </button>
            ))}
            <button
              onClick={() => setDialogOpen(true)}
              className="shrink-0 rounded-full border border-dashed border-line px-3.5 py-1.5 text-[13px] text-clay"
            >
              + Add
            </button>
            <Link
              href="/reading-list"
              className="shrink-0 rounded-full border border-line bg-paper-raised px-3.5 py-1.5 text-[13px] text-ink-soft"
            >
              Read later{readingCount > 0 ? ` (${readingCount})` : ""}
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse overflow-hidden rounded-2xl border border-line bg-paper-raised"
                >
                  <div className="aspect-video bg-paper-sunken" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-11/12 rounded bg-paper-sunken" />
                    <div className="h-4 w-2/3 rounded bg-paper-sunken" />
                    <div className="h-3 w-1/3 rounded bg-paper-sunken" />
                  </div>
                </div>
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="font-serif text-xl text-ink">Nothing here yet</p>
              <p className="max-w-sm text-sm text-ink-faint">
                Add a publication with the button in the sidebar and fresh
                articles will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  onToast={(message, error) => {
                    showToast(message, error);
                    if (!error) loadReadingCount();
                  }}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {dialogOpen && (
        <AddFeedDialog
          onClose={() => setDialogOpen(false)}
          onAdded={() => {
            loadFeeds();
            loadArticles(selectedFeedId);
          }}
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
