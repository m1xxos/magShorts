import { TAG_COLORS, articleTags } from "@/lib/types";

// Omnivore-style topic pills: pastel dot + slug. Renders nothing visible
// for untagged articles but can reserve its row to keep card heights even.
export function TagPills({
  tags,
  max = 3,
  reserveRow = false,
}: {
  tags: string | null | undefined;
  max?: number;
  reserveRow?: boolean;
}) {
  const slugs = articleTags(tags).slice(0, max);
  if (slugs.length === 0 && !reserveRow) return null;
  return (
    <div
      className={`flex items-center gap-1.5 overflow-hidden ${
        reserveRow ? "h-[26px]" : ""
      }`}
    >
      {slugs.map((slug) => (
        <span
          key={slug}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-ink-soft"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: TAG_COLORS[slug] ?? "#b0aca0" }}
          />
          {slug}
        </span>
      ))}
    </div>
  );
}
