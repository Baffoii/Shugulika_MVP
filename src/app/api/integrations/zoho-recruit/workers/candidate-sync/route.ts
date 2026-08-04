import { NextResponse } from "next/server";
import { syncZohoCandidatesToSearchCache } from "@/lib/integrations/zoho-recruit/candidate-sync";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { requireWorkerAuthorization } from "@/lib/integrations/zoho-recruit/worker-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bearer-auth worker: pull Zoho Candidates into the search cache. */
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

  const client = createServiceRoleClient();
  if (!client) {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const result = await syncZohoCandidatesToSearchCache({ lockedBy: "worker:candidate-sync" });
  const status = result.status === "failed" ? 500 : 200;
  return NextResponse.json(result, { status });
}
