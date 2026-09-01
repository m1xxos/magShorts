import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// What a client calls to find out whether the address and the token are both
// right, before it writes anything into somebody's notes.
export async function GET(request: NextRequest) {
  const user = getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, username: user.username });
}
