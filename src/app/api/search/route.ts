import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isSearchSort, searchArticles } from "@/lib/search";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();
  // An empty box means "nothing yet", not "everything".
  if (!query) return NextResponse.json([]);

  const limit = Math.min(
    Math.max(Math.floor(Number(params.get("limit"))) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const offset = Math.max(Math.floor(Number(params.get("offset"))) || 0, 0);

  // An unknown sort is relevance rather than a 400: it arrives from a URL
  // somebody can edit, and the honest answer to "sort=banana" is the results
  // in their usual order, not an error page where the search used to be.
  const sortParam = params.get("sort");
  const sort = isSearchSort(sortParam) ? sortParam : "relevance";

  // Same for the publication: a feed that is not a number, or one the reader
  // does not subscribe to, simply does not narrow anything — the WHERE clause
  // is already scoped to their own subscriptions.
  const feedParam = Number(params.get("feed"));
  const feedId = Number.isInteger(feedParam) && feedParam > 0 ? feedParam : null;

  // A bare array, the same shape /api/articles returns, so the grid that draws
  // the feed can draw these without learning anything new.
  return NextResponse.json(
    searchArticles(query, limit, offset, { sort, feedId })
  );
}
