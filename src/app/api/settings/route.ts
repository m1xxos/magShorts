import { switchCity } from "@/lib/city";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  currentCity,
  getAllSettings,
  setSetting,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(getAllSettings());
}

export async function PUT(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Read before the write, because switching cities has to know which one it
  // is switching away from.
  const cityBefore = currentCity();

  for (const key of SETTING_KEYS) {
    if (typeof body[key] === "string") {
      setSetting(key as SettingKey, body[key] as string);
    }
  }

  if (typeof body.city === "string") switchCity(cityBefore, currentCity());

  return NextResponse.json(getAllSettings());
}
