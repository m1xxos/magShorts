import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { seedCatalog, suggestCatalog } from "@/lib/catalogSuggest";

export const dynamic = "force-dynamic";

// Fills the catalog on demand: `{ "seed": true }` runs the curated list,
// otherwise the model proposes publications like the ones you save. Either
// way every candidate must resolve to a real feed before it is stored, so a
// run that adds nothing is a normal outcome, not an error.
export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { seed?: boolean };
  const results = body.seed === true
    ? await seedCatalog()
    : await suggestCatalog(user.id);

  return NextResponse.json({
    added: results.filter((entry) => entry.status === "added").length,
    duplicates: results.filter((entry) => entry.status === "duplicate").length,
    rejected: results
      .filter((entry) => entry.status === "unreachable")
      .map((entry) => ({ name: entry.name, url: entry.url })),
  });
}
