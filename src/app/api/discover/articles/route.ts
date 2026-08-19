import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { catalogArticles, catalogSize, catalogTopics } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const { articles, total } = catalogArticles(user.id, {
    topic: params.get("topic")?.trim() || undefined,
    // Set by "more from this publication"; ignored when absent.
    feedId: params.get("feed") ? Number(params.get("feed")) : undefined,
    query: params.get("q")?.trim() || undefined,
    limit: Math.min(Number(params.get("limit") ?? 24), 100),
    offset: Math.max(Number(params.get("offset") ?? 0), 0),
  });

  return NextResponse.json({
    articles,
    total,
    catalog_size: catalogSize(),
    topics: catalogTopics(),
  });
}
