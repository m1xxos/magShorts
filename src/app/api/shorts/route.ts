import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { refreshStaleFeeds } from "@/lib/rss";
import { recommendShorts } from "@/lib/recommend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? 40),
    200
  );
  const folderParam = request.nextUrl.searchParams.get("folder");
  const folderId = folderParam ? Number(folderParam) : undefined;
  if (folderId !== undefined && !Number.isInteger(folderId)) {
    return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
  }

  await refreshStaleFeeds();

  return NextResponse.json(recommendShorts(user.id, limit, folderId));
}
