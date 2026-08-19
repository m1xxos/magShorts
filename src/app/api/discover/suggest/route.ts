import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { seedCatalog, suggestCatalog } from "@/lib/catalogSuggest";

export const dynamic = "force-dynamic";

// Fills the catalog on demand: `{ "seed": true }` runs the curated list,
// otherwise the model proposes publications like the ones you save. Either
// way every candidate must resolve to a real feed before it is stored, so a
// run that adds nothing is a normal outcome, not an error.
//
// The same suggestion pass runs by itself once a day from the scheduler; this
// is the button for when you want more now. Pressing it also retries domains
// the automatic runs have written off, since those may just have been down.
export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    seed?: boolean;
    // Which angle to ask from; the rotation picks one on its own otherwise.
    brief?: number;
  };
  const results = body.seed === true
    ? await seedCatalog()
    : await suggestCatalog(user.id, { retryDead: true, brief: body.brief });

  return NextResponse.json({
    added: results.filter((entry) => entry.status === "added").length,
    duplicates: results.filter((entry) => entry.status === "duplicate").length,
    // Verified, fetched, and then judged not to belong — worth reporting
    // separately from a domain that never resolved.
    mismatched: results
      .filter((entry) => entry.status === "mismatch")
      .map((entry) => entry.name),
    rejected: results
      .filter((entry) => entry.status === "unreachable")
      .map((entry) => ({ name: entry.name, url: entry.url })),
  });
}
