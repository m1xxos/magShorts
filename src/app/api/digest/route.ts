import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { digestTimeZone, readDigest } from "@/lib/digest";
import { type DigestKind } from "@/lib/types";

export const dynamic = "force-dynamic";

// A pure read of the stored snapshot. Nothing here builds, ranks or calls a
// model — switching Daily/Weekly on the page is two of these.
export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind: DigestKind =
    request.nextUrl.searchParams.get("kind") === "weekly" ? "weekly" : "daily";

  return NextResponse.json({
    kind,
    digest: readDigest(user.id, kind),
    // So the settings panel can state the real schedule instead of the
    // defaults it was drawn with.
    schedule: {
      daily: process.env.DIGEST_DAILY_AT?.trim() || "08:00",
      weekly: process.env.DIGEST_WEEKLY_AT?.trim() || "Sun 19:00",
      timeZone: digestTimeZone(),
    },
  });
}
