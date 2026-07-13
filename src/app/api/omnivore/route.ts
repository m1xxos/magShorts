import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const SAVE_URL_MUTATION = `
  mutation SaveUrl($input: SaveUrlInput!) {
    saveUrl(input: $input) {
      ... on SaveSuccess { url clientRequestId }
      ... on SaveError { errorCodes message }
    }
  }
`;

export async function POST(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let url: string;
  try {
    const body = await request.json();
    url = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "Invalid article URL" }, { status: 400 });
  }

  const omnivoreUrl = getSetting("omnivore_url").replace(/\/+$/, "");
  const apiKey = getSetting("omnivore_api_key");
  if (!omnivoreUrl || !apiKey) {
    return NextResponse.json(
      {
        error:
          "Omnivore is not configured — set its URL and API key in Settings",
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${omnivoreUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({
        query: SAVE_URL_MUTATION,
        variables: {
          input: {
            clientRequestId: crypto.randomUUID(),
            source: "api",
            url,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Omnivore responded with HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const result = await response.json();
    const saved = result?.data?.saveUrl;
    if (result.errors?.length || saved?.errorCodes?.length) {
      const message =
        saved?.message ??
        saved?.errorCodes?.join(", ") ??
        result.errors?.[0]?.message ??
        "Unknown Omnivore error";
      return NextResponse.json(
        { error: `Omnivore rejected the article: ${message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, url: saved?.url ?? null });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the Omnivore instance" },
      { status: 502 }
    );
  }
}
