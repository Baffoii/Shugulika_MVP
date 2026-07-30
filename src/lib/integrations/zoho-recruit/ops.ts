import "server-only";

import { scopesMissing, ZOHO_RECRUIT_SYNC_SCOPES } from "@/lib/integrations/zoho-recruit/config";
import { getZohoRecruitGateStatus, type GateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ZohoRecruitOpsSnapshot {
  gates: GateStatus;
  scopesMissing: string[];
  grantedScopes: string[];
  connectionStatus: string | null;
  syncPausedAt: string | null;
  syncPausedReason: string | null;
  pendingOutboxCount: number;
  oldestPendingAgeSeconds: number | null;
  deadLetterCount: number;
  openConflictCount: number;
  lastReconciliation: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    recordsChecked: number;
    differencesFound: number;
  } | null;
  rateLimitObservation: Record<string, unknown> | null;
}

/**
 * Sanitized HQ ops snapshot — no tokens, secrets, or PII payloads.
 */
export async function getZohoRecruitOpsSnapshot(): Promise<ZohoRecruitOpsSnapshot> {
  const gates = await getZohoRecruitGateStatus();
  const empty: ZohoRecruitOpsSnapshot = {
    gates,
    scopesMissing: [...ZOHO_RECRUIT_SYNC_SCOPES],
    grantedScopes: [],
    connectionStatus: null,
    syncPausedAt: null,
    syncPausedReason: null,
    pendingOutboxCount: 0,
    oldestPendingAgeSeconds: null,
    deadLetterCount: 0,
    openConflictCount: 0,
    lastReconciliation: null,
    rateLimitObservation: null,
  };

  const client = createServiceRoleClient();
  if (!client) return empty;

  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("status, granted_scopes, sync_paused_at, sync_paused_reason, last_rate_limit")
    .eq("connection_key", "primary")
    .maybeSingle();

  const grantedScopes = (connection?.granted_scopes as string[] | undefined) ?? [];
  const missing = scopesMissing(grantedScopes);

  const now = Date.now();

  const [
    { count: pendingCount },
    { data: oldestPending },
    { count: deadCount },
    { count: conflictCount },
    { data: lastRecon },
  ] = await Promise.all([
    client
      .from("zoho_recruit_outbox")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "retry"]),
    client
      .from("zoho_recruit_outbox")
      .select("available_at, created_at")
      .in("status", ["queued", "retry"])
      .order("available_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    client
      .from("zoho_recruit_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter"),
    client
      .from("zoho_recruit_conflicts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    client
      .from("zoho_recruit_reconciliations")
      .select("id, status, started_at, completed_at, records_checked, differences_found")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let oldestPendingAgeSeconds: number | null = null;
  if (oldestPending) {
    const ts = new Date(
      (oldestPending as { available_at?: string; created_at?: string }).created_at ??
        (oldestPending as { available_at: string }).available_at,
    ).getTime();
    if (Number.isFinite(ts)) {
      oldestPendingAgeSeconds = Math.max(0, Math.floor((now - ts) / 1000));
    }
  }

  const rateLimit =
    connection?.last_rate_limit &&
    typeof connection.last_rate_limit === "object" &&
    !Array.isArray(connection.last_rate_limit)
      ? (connection.last_rate_limit as Record<string, unknown>)
      : null;

  return {
    gates,
    scopesMissing: missing,
    grantedScopes,
    connectionStatus: (connection?.status as string | undefined) ?? null,
    syncPausedAt: (connection?.sync_paused_at as string | null | undefined) ?? null,
    syncPausedReason: (connection?.sync_paused_reason as string | null | undefined) ?? null,
    pendingOutboxCount: pendingCount ?? 0,
    oldestPendingAgeSeconds,
    deadLetterCount: deadCount ?? 0,
    openConflictCount: conflictCount ?? 0,
    lastReconciliation: lastRecon
      ? {
          id: (lastRecon as { id: string }).id,
          status: (lastRecon as { status: string }).status,
          startedAt: (lastRecon as { started_at: string }).started_at,
          completedAt: (lastRecon as { completed_at: string | null }).completed_at,
          recordsChecked: (lastRecon as { records_checked: number }).records_checked,
          differencesFound: (lastRecon as { differences_found: number }).differences_found,
        }
      : null,
    rateLimitObservation: rateLimit,
  };
}
