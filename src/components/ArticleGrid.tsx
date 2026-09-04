"use client";

import { type ArticleDto, type Density } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";

// How a list of articles is drawn, in one place. The home grid and the search
// results are the same thing looked at through two different queries, and
// keeping two copies of this is how they would stop looking alike.

const GRID_CLASSES: Record<Density, string> = {
  // Two floors, because no single one satisfies both ends: a portrait tablet
  // needs <=238px to fit three columns, while five columns on a 2000px window
  // need >258px.
  cards:
    "grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5 min-[1536px]:grid-cols-[repeat(auto-fill,minmax(270px,1fr))]",
  // The dense modes get their own, much wider minimum so a row never stretches
  // to a full window's worth of unreadably long summary lines.
  list: "grid grid-cols-[repeat(auto-fill,minmax(520px,1fr))] gap-3",
  compact: "grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-1.5",
};

function Skeleton({ density }: { density: Density }) {
  if (density === "compact") {
    return (
      <div className="flex min-h-14 animate-pulse items-center gap-3 rounded-xl border border-line bg-paper-raised px-4">
        <div className="h-6 w-6 shrink-0 rounded-full bg-paper-sunken" />
        <div className="h-4 w-2/3 rounded bg-paper-sunken" />
      </div>
    );
  }
  if (density === "list") {
    return (
      <div className="flex animate-pulse gap-4 rounded-2xl border border-line bg-paper-raised p-3">
        <div className="aspect-[4/3] w-[104px] shrink-0 rounded-[10px] bg-paper-sunken sm:w-[140px]" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3 w-1/4 rounded bg-paper-sunken" />
          <div className="h-4 w-10/12 rounded bg-paper-sunken" />
          <div className="h-3 w-full rounded bg-paper-sunken" />
        </div>
      </div>
    );
  }
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-line bg-paper-raised">
      <div className="aspect-[2/1] bg-paper-sunken" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-11/12 rounded bg-paper-sunken" />
        <div className="h-4 w-2/3 rounded bg-paper-sunken" />
        <div className="h-3 w-1/3 rounded bg-paper-sunken" />
      </div>
    </div>
  );
}

export function ArticleGridSkeleton({ density }: { density: Density }) {
  return (
    <div className={GRID_CLASSES[density]}>
      {Array.from({ length: density === "compact" ? 12 : 8 }).map(
        (_, index) => (
          <Skeleton key={index} density={density} />
        )
      )}
    </div>
  );
}

export function ArticleGrid({
  articles,
  density,
  onOpen,
  onToast,
}: {
  articles: ArticleDto[];
  density: Density;
  // Withheld where headlines should leave for the publisher instead: the card
  // branches on whether it was given a handler.
  onOpen?: (article: ArticleDto) => void;
  onToast: (message: string, error?: boolean) => void;
}) {
  return (
    <div className={GRID_CLASSES[density]}>
      {articles.map((article) => (
        <ArticleCard
          key={article.id}
          article={article}
          density={density}
          onOpen={onOpen}
          onToast={onToast}
        />
      ))}
    </div>
  );
}
