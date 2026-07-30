import { NextResponse } from "next/server";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { claimOutboxBatch } from "@/lib/integrations/zoho-recruit/outbox";
import { processOutboxRow } from "@/lib/integrations/zoho-recruit/process-outbox";
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

  const claimed = await claimOutboxBatch(10);
  const results = [];
  for (const row of claimed) {
    results.push({
      id: row.id,
      eventId: row.event_id,
      ...(await processOutboxRow(row)),
    });
  }

  return NextResponse.json({
    skipped: false,
    claimed: claimed.length,
    results,
  });
}
