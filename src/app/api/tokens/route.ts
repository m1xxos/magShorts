import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listTokens, mintToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const NAME_MAX = 60;

// getSessionUser, not getApiUser, and that is the whole security story of this
// file: a token must never be able to mint another token. Losing one then costs
// exactly the highlights it could read, and revoking it ends the matter.
export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(listTokens(user.id));
}

export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, NAME_MAX) : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // The one response that carries the token itself. Every later read of this
  // table gets the prefix and nothing else.
  const { token, row } = mintToken(user.id, name);
  return NextResponse.json({ ...row, token }, { status: 201 });
}
