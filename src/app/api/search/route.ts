import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { searchArticles } from "@/lib/search";

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

  // A bare array, the same shape /api/articles returns, so the grid that draws
  // the feed can draw these without learning anything new.
  return NextResponse.json(searchArticles(query, limit, offset));
}
