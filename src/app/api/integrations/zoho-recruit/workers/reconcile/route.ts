import { NextResponse } from "next/server";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { runZohoRecruitReconciliation } from "@/lib/integrations/zoho-recruit/reconcile";
import { requireWorkerAuthorization } from "@/lib/integrations/zoho-recruit/worker-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireWorkerAuthorization(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dryRun =
    url.searchParams.get("dry_run") === "1" || url.searchParams.get("dry_run") === "true";

  const gates = await getZohoRecruitGateStatus();
  if (!gates.syncAllowed) {
    return NextResponse.json(
      {
        skipped: true,
        reason: gates.blockedReasons.join("; ") || "sync gates disabled",
        dry_run: dryRun,
        gates: gates.flags,
      },
      { status: 200 },
    );
  }

  const client = createServiceRoleClient();
  if (!client) {
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("id")
    .eq("connection_key", "primary")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "connection_missing" }, { status: 503 });
  }

  const result = await runZohoRecruitReconciliation({
    connectionId: (connection as { id: string }).id,
    dryRun,
  });

  return NextResponse.json(result);
}
