import { NextResponse } from "next/server";
import { requireWorkerAuthorization } from "@/lib/integrations/zoho-recruit/worker-auth";
import { getImportGateStatus } from "@/lib/integrations/zoho-recruit/import/gates";
import { runImportStage } from "@/lib/integrations/zoho-recruit/import/pipeline";
import { liveZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/source";
import { getImportBatch } from "@/lib/integrations/zoho-recruit/import/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Advance one staged candidate-import batch by exactly one stage.
 *
 * One stage per call, deliberately: the operator (or the cron that drives them)
 * can stop after `dry_run`, read the batch report, and only then let it carry
 * on. A worker that ran the whole pipeline in one invocation would remove the
 * point at which a human can say no.
 *
 * Returns 200 with `skipped: true` when a gate is off — a disabled import is a
 * normal state, not an error the caller should retry against.
 */
export async function POST(request: Request) {
  const denied = requireWorkerAuthorization(request);
  if (denied) return denied;

  const gates = await getImportGateStatus();
  if (!gates.stagingAllowed) {
    return NextResponse.json(
      {
        skipped: true,
        reason: gates.blockedReasons.join("; ") || "candidate import gates disabled",
        gates: gates.flags,
      },
      { status: 200 },
    );
  }

  let batchId: string | null = null;
  try {
    const body = (await request.json()) as { batchId?: unknown };
    if (typeof body?.batchId === "string") batchId = body.batchId;
  } catch {
    // No body is fine; the error below covers the missing id.
  }

  if (!batchId) {
    return NextResponse.json({ error: "batch_id_required" }, { status: 400 });
  }

  const batch = await getImportBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  }

  const result = await runImportStage(batchId, liveZohoCandidateSource());
  if (!result) {
    return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  }

  if (result.blocked) {
    return NextResponse.json(
      { skipped: true, reason: result.blocked.join("; "), batchId, stage: result.from },
      { status: 200 },
    );
  }

  return NextResponse.json({
    skipped: false,
    batchId,
    from: result.from,
    to: result.to,
    totals: result.totals,
    notes: result.notes,
  });
}
