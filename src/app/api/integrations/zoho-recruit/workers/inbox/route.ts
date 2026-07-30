import { NextResponse } from "next/server";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { claimInboxBatch, processInboxRow } from "@/lib/integrations/zoho-recruit/inbox";
import { requireWorkerAuthorization } from "@/lib/integrations/zoho-recruit/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireWorkerAuthorization(request);
  if (denied) return denied;

  const gates = await getZohoRecruitGateStatus();
  if (!gates.syncAllowed) {
    return NextResponse.json(
      {
        skipped: true,
        reason: gates.blockedReasons.join("; ") || "sync gates disabled",
        gates: gates.flags,
      },
      { status: 200 },
    );
  }

  const claimed = await claimInboxBatch(20);
  const results = [];
  for (const row of claimed) {
    results.push({
      id: row.id,
      ...(await processInboxRow(row)),
    });
  }

  return NextResponse.json({
    skipped: false,
    claimed: claimed.length,
    results,
  });
}
