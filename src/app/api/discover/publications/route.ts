import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { catalogPublications, catalogSize, catalogTopics } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const { publications, total } = catalogPublications(user.id, {
    topic: params.get("topic")?.trim() || undefined,
    query: params.get("q")?.trim() || undefined,
    limit: Math.min(Number(params.get("limit") ?? 12), 50),
    offset: Math.max(Number(params.get("offset") ?? 0), 0),
  });

  return NextResponse.json({
    publications,
    total,
    // The header line and the chips describe the whole catalog, not the page,
    // so they travel with every response rather than needing a second call.
    catalog_size: catalogSize(),
    topics: catalogTopics(),
  });
}
