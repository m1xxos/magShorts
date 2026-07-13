import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { refreshStaleFeeds } from "@/lib/rss";
import {
  REC_WINDOWS,
  recommendArticles,
  type RecWindow,
} from "@/lib/recommend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const windowParam = searchParams.get("window") ?? "week";
  if (!REC_WINDOWS.includes(windowParam as RecWindow)) {
    return NextResponse.json(
      { error: "window must be day, week or month" },
      { status: 400 }
    );
  }
  const limit = Math.min(Number(searchParams.get("limit") ?? 40), 200);
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  await refreshStaleFeeds();

  return NextResponse.json(
    recommendArticles(user.id, windowParam as RecWindow, limit, offset)
  );
}
