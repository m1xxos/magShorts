import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildDigest, duePeriodKey } from "@/lib/digest";
import { type DigestKind } from "@/lib/types";

export const dynamic = "force-dynamic";

// Manual trigger for the signed-in user's own digest — the scheduler builds
// these at 08:00 and on Sunday evening, and this is how you get one now.
//
// It awaits the build (which can take minutes on a small box) rather than
// returning early, because the only callers are a human waiting for the
// result and the verification scripts. `force: true` discards an existing
// snapshot for the period and rebuilds it; without it an existing snapshot is
// returned untouched, matching the scheduler's idempotency.
export async function POST(request: NextRequest) {
  const user = getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    force?: boolean;
  };
  const kind: DigestKind = body.kind === "weekly" ? "weekly" : "daily";
  const periodKey = duePeriodKey(kind);

  const result = await buildDigest(user.id, kind, {
    periodKey,
    force: body.force === true,
  });

  if (!result) {
    return NextResponse.json(
      { kind, periodKey, built: false, reason: "nothing to digest for this period" },
      { status: 200 }
    );
  }

  return NextResponse.json({
    kind,
    periodKey,
    built: true,
    created: result.created,
    digestId: result.digestId,
    llmCalls: result.llmCalls,
  });
}
