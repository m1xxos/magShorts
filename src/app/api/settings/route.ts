import { NextRequest, NextResponse } from "next/server";
import {
  getAllSettings,
  setSetting,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAllSettings());
}

export async function PUT(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  for (const key of SETTING_KEYS) {
    if (typeof body[key] === "string") {
      setSetting(key as SettingKey, body[key] as string);
    }
  }
  return NextResponse.json(getAllSettings());
}
