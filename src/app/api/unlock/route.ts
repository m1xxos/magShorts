import { NextRequest, NextResponse } from "next/server";
import { getSetting, isDirectDomain } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") ?? "";
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (isDirectDomain(url)) {
    return NextResponse.redirect(url);
  }
  const marretaUrl = getSetting("marreta_url").replace(/\/+$/, "");
  return NextResponse.redirect(`${marretaUrl}/p/${url}`);
}
