import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { searchSources } from "@/lib/search";

export const dynamic = "force-dynamic";

// Which publications the current search found something in, and how many from
// each. A separate route rather than a field on the results: the results are
// paged and this is not, and /api/search returns a bare array of ArticleDto
// precisely so the grid can draw it without learning a wrapper.
export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json([]);

  return NextResponse.json(searchSources(query));
}
