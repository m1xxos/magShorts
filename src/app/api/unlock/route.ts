import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSetting, isArchiveDomain, isDirectDomain } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    // Navigated to directly from links, so send humans to the login page.
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const url = request.nextUrl.searchParams.get("url") ?? "";
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (isDirectDomain(url)) {
    return NextResponse.redirect(url);
  }
  if (isArchiveDomain(url)) {
    // Marreta can't fetch these sites; a web archive usually has a snapshot.
    const archiveUrl = getSetting("archive_url").replace(/\/+$/, "");
    return NextResponse.redirect(`${archiveUrl}/${url}`);
  }
  const marretaUrl = getSetting("marreta_url").replace(/\/+$/, "");
  return NextResponse.redirect(`${marretaUrl}/p/${url}`);
}
