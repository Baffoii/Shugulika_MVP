import "server-only";

/**
 * Zoho-owned import / ops health metrics for the HQ data-quality page.
 *
 * Kept out of `src/lib/data/*` so ordinary data loaders never depend on the
 * Zoho Recruit integration (enforced by isolation.test.ts).
 */
import { listRecentBatches } from "@/lib/integrations/zoho-recruit/import/store";
import { getImportGateStatus } from "@/lib/integrations/zoho-recruit/import/gates";
import { getZohoRecruitOpsSnapshot } from "@/lib/integrations/zoho-recruit/ops";
import { getHqDataQualityCounts } from "@/lib/data/hq-data-quality";
import type { ImportHealthMetrics, SourceFreshness } from "@/lib/data/hq-data-quality";

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function hoursSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.round(((now - parsed) / 3_600_000) * 10) / 10);
}

export async function getImportHealth(): Promise<ImportHealthMetrics> {
  const [batches, gates] = await Promise.all([listRecentBatches(10), getImportGateStatus()]);
  const latest = batches[0] ?? null;

  let processed = 0;
  let quarantined = 0;
  let failed = 0;
  let awaitingReview = 0;

  for (const batch of batches) {
    const totals = (batch.totals ?? {}) as Record<string, number | undefined>;
    processed += totals.inventoried ?? 0;
    quarantined += totals.quarantined ?? 0;
    failed += totals.failed ?? 0;
    awaitingReview += totals.needsReview ?? 0;
  }

  return {
    batches: batches.length,
    lastBatchAt: latest?.created_at ?? null,
    lastBatchStage: latest?.stage ?? null,
    lastBatchStatus: latest?.status ?? null,
    recordsProcessed: processed,
    recordsQuarantined: quarantined,
    recordsFailed: failed,
    recordsAwaitingReview: awaitingReview,
    errorRate: rate(quarantined + failed, processed),
    gatesBlocked: gates.blockedReasons,
  };
}

export async function getZohoImportFreshness(now = Date.now()): Promise<SourceFreshness> {
  const batches = await listRecentBatches(1);
  const lastImport = batches[0]?.created_at ?? null;
  return {
    source: "Zoho candidate import",
    lastSeenAt: lastImport,
    ageHours: hoursSince(lastImport, now),
  };
}

export type HqDataQualitySnapshot = {
  openConflictCount: number;
  pendingOutboxCount: number;
  oldestPendingAgeSeconds: number | null;
  deadLetterCount: number;
  lastReconciliation: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    recordsChecked: number;
    differencesFound: number;
  } | null;
  syncPausedAt: string | null;
  scopesMissing: string[];
  connectionStatus: string | null;
  credentialExpiryIndicator: "unknown" | "ok" | "expiring" | "expired";
  probableDuplicateCandidates: number;
  probableDuplicateEmployers: number;
  unresolvedMergeTasks: number;
  missingRequiredFieldSignals: number;
  staleZohoRecords: number;
};

/** Integration + canonical data-quality counts for the HQ data-quality page. */
export async function getHqDataQualitySnapshot(): Promise<HqDataQualitySnapshot> {
  const [ops, quality] = await Promise.all([
    getZohoRecruitOpsSnapshot(),
    getHqDataQualityCounts().catch((error: unknown) => {
      console.error("[getHqDataQualitySnapshot] data-quality counts unavailable:", error);
      return {
        probableDuplicateCandidates: 0,
        unresolvedMergeTasks: 0,
        missingRequiredFieldSignals: 0,
        lowConfidenceParsedFields: 0,
      };
    }),
  ]);

  return {
    openConflictCount: ops.openConflictCount,
    pendingOutboxCount: ops.pendingOutboxCount,
    oldestPendingAgeSeconds: ops.oldestPendingAgeSeconds,
    deadLetterCount: ops.deadLetterCount,
    lastReconciliation: ops.lastReconciliation,
    syncPausedAt: ops.syncPausedAt,
    scopesMissing: ops.scopesMissing,
    connectionStatus: ops.connectionStatus,
    credentialExpiryIndicator: "unknown",
    probableDuplicateCandidates: quality.probableDuplicateCandidates,
    probableDuplicateEmployers: 0,
    unresolvedMergeTasks: quality.unresolvedMergeTasks,
    missingRequiredFieldSignals: quality.missingRequiredFieldSignals,
    staleZohoRecords: ops.openConflictCount,
  };
}
