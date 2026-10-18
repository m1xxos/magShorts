import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isMailerConfigured } from "@/lib/mailer";
import { sendWeeklyDigestEmail } from "@/lib/digestEmail";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = isMailerConfigured();
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const userRow = db
    .prepare("SELECT email FROM users WHERE id = ?")
    .get(user.id) as { email: string | null } | undefined;

  if (!userRow || !userRow.email) {
    return NextResponse.json(
      { error: "No email address set. Please enter an email in Settings." },
      { status: 400 }
    );
  }

  const result = await sendWeeklyDigestEmail(user.id, { isTest: true });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    recipient: userRow.email,
  });
}
