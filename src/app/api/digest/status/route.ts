import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { duePeriodKey, hasDigest } from "@/lib/digest";

export const dynamic = "force-dynamic";

// Is there a digest for the current period, and which period is it?
//
// The sidebar's `today` marker needs exactly this and nothing else. GET
// /api/digest answers it too, but by returning the entire snapshot — every
// card, every blurb, the schedule — and the rail is now on five pages. This is
// one indexed row existence check.
//
// Whether it has been *read* is not a server fact: nothing records opening a
// digest, and inventing a table for it would make a marker more expensive than
// the thing it marks. The client compares `period_key` against what it last
// saw, which is per-browser and honest about it.
export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const periodKey = duePeriodKey("daily");
  return NextResponse.json({
    period_key: periodKey,
    ready: hasDigest(user.id, "daily", periodKey),
  });
}
