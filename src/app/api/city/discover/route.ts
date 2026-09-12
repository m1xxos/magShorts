import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { discoverCitySources } from "@/lib/city";

export const dynamic = "force-dynamic";

// Ask the model for this city's local press and verify what it names.
//
// Awaits the whole run, like /api/discover/suggest: it is a button somebody
// pressed and the answer is the point. A dozen candidates each needing a feed
// lookup takes tens of seconds.
export async function POST(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await discoverCitySources();
  if (!result.city) {
    return NextResponse.json(
      { error: "Name your city in Settings first" },
      { status: 400 }
    );
  }
  // additions: null means nothing was tried, which is a different answer from
  // "tried and found nothing" and the page says so.
  return NextResponse.json(result);
}
