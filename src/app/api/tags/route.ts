import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { subscriptionTags } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(subscriptionTags());
}
