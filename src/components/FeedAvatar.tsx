import { feedTone } from "@/lib/types";

export function FeedAvatar({
  feedId,
  title,
  size = 28,
}: {
  feedId: number;
  title: string;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-serif text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        backgroundColor: feedTone(feedId),
      }}
    >
      {title.trim().charAt(0).toUpperCase()}
    </span>
  );
}
