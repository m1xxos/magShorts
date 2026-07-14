import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getCachedImage, isCacheableImageUrl } from "@/lib/imageCache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("u") ?? "";
  if (!isCacheableImageUrl(url)) {
    return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
  }
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const image = await getCachedImage(url);
  if (!image) {
    // Let the browser try the origin directly — the UI never breaks.
    return NextResponse.redirect(url, 302);
  }

  return new NextResponse(new Uint8Array(image.buffer), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.buffer.byteLength),
      "Cache-Control": "public, max-age=2592000, immutable",
    },
  });
}
