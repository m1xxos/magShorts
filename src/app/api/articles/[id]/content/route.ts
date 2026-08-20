import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { extractArticle, readContent } from "@/lib/extract";

export const dynamic = "force-dynamic";

// The reader's body text.
//
// GET reads the cache and never touches the network — safe to call from
// anywhere. POST is the only thing in the app that fetches an article page for
// the reader, and it is called from exactly two places: opening the reader and
// saving to Read later. That split is the whole point of the "lazy" in this
// feature: nothing a list render does can reach the network.

function articleId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = articleId(id);
  if (parsed === null) {
    return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
  }
  const content = readContent(parsed);
  // Not an error: "nothing extracted yet" is the normal first answer, and it
  // is what tells the client to POST.
  return NextResponse.json(
    content ?? {
      article_id: parsed,
      status: "missing",
      html: null,
      headings: [],
      reading_minutes: null,
      source: null,
      extracted_at: null,
    }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = articleId(id);
  if (parsed === null) {
    return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
  }
  // `force` is the Retry button: it re-runs the chain for an article whose
  // failures have already been cached.
  const force = request.nextUrl.searchParams.get("retry") === "1";
  return NextResponse.json(await extractArticle(parsed, { force }));
}
