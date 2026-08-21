import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { relatedArticles } from "@/lib/related";

export const dynamic = "force-dynamic";

// What to read after this article. An empty list is a normal answer — the
// article may have no embedding yet, or nothing near enough to be worth
// offering — and the reader falls back to the list it was opened from.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 2), 1), 6);
  return NextResponse.json(relatedArticles(articleId, user.id, limit));
}
