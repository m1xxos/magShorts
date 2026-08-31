import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isStatsRange, readingStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = request.nextUrl.searchParams.get("range") ?? "month";
  if (!isStatsRange(range)) {
    return NextResponse.json(
      { error: "range must be week, month or year" },
      { status: 400 }
    );
  }

  return NextResponse.json(readingStats(user.id, range));
}
