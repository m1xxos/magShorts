import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dismissPublication } from "@/lib/catalogSuggest";

export const dynamic = "force-dynamic";

// Throw a publication out of the catalog. The catalog proposes; this is how
// you answer. The host is remembered, so the daily suggestion run can't hand
// the same publication back tomorrow — without that, dismissing one buys a
// day and nothing more.
//
// Subscriptions are not dismissable: unsubscribing is a different act with a
// different meaning, and it already has its own switch.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const feedId = Number(id);
  if (!Number.isInteger(feedId)) {
    return NextResponse.json({ error: "Invalid publication id" }, { status: 400 });
  }
  if (!dismissPublication(feedId)) {
    return NextResponse.json(
      { error: "Not a catalog publication" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
