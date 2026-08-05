import "server-only";

/**
 * Persistence for staged Zoho candidate imports.
 *
 * The staging tables are server-only (no anon/authenticated grants), matching
 * the rest of the Zoho satellite, so everything here runs on the service-role
 * client. HQ sees a sanitized summary through `hq-data-quality.ts` after an
 * application-layer role check — never a direct table read.
 *
 * Durable local↔Zoho identity is written to `zoho_recruit_external_mappings`
 * and only there. The `zoho_record_id` on a staging row is a batch work item;
 * `purgeBatchRecords` exists so a finished batch can be discarded without
 * touching that mapping.
 */
import {
  asAtsClient,
  type ZohoCandidateImportBatchRow,
  type ZohoCandidateImportRecordRow,
} from "@/lib/candidates/db";
import type { ImportStage } from "@/lib/candidates/constants";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { BatchTotals, StageTransition } from "@/lib/integrations/zoho-recruit/import/stages";

function atsServiceClient() {
  const client = createServiceRoleClient();
  return client ? asAtsClient(client) : null;
}

export interface CreateBatchInput {
  connectionId: string;
  requestedBy: string | null;
  isDryRun: boolean;
  sourceModule?: string;
}

export async function createImportBatch(
  input: CreateBatchInput,
): Promise<ZohoCandidateImportBatchRow | null> {
  const client = atsServiceClient();
  if (!client) return null;

  const { data, error } = await client
    .from("zoho_candidate_import_batches")
    .insert({
      connection_id: input.connectionId,
      requested_by: input.requestedBy,
      is_dry_run: input.isDryRun,
      source_module: input.sourceModule ?? "Candidates",
      stage: "inventory",
      status: "open",
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("[zoho-import/store] createImportBatch failed:", error.message);
    return null;
  }
  return data as ZohoCandidateImportBatchRow;
}

export async function getImportBatch(id: string): Promise<ZohoCandidateImportBatchRow | null> {
  const client = atsServiceClient();
  if (!client) return null;
  const { data } = await client
    .from("zoho_candidate_import_batches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as ZohoCandidateImportBatchRow | null) ?? null;
}

export async function listRecentBatches(limit = 20): Promise<ZohoCandidateImportBatchRow[]> {
  const client = atsServiceClient();
  if (!client) return [];
  const { data } = await client
    .from("zoho_candidate_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ZohoCandidateImportBatchRow[] | null) ?? [];
}

export async function updateBatch(
  id: string,
  patch: {
    stage?: ImportStage;
    status?: ZohoCandidateImportBatchRow["status"];
    totals?: BatchTotals;
    stageHistory?: StageTransition[];
    report?: Record<string, unknown>;
    completedAt?: string | null;
    lastError?: string | null;
  },
): Promise<boolean> {
  const client = atsServiceClient();
  if (!client) return false;

  const { error } = await client
    .from("zoho_candidate_import_batches")
    .update({
      ...(patch.stage ? { stage: patch.stage } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.totals ? { totals: patch.totals as unknown as Record<string, unknown> } : {}),
      ...(patch.stageHistory
        ? { stage_history: patch.stageHistory as unknown as Record<string, unknown>[] }
        : {}),
      ...(patch.report ? { report: patch.report } : {}),
      ...(patch.completedAt !== undefined ? { completed_at: patch.completedAt } : {}),
      ...(patch.lastError !== undefined ? { last_error: patch.lastError } : {}),
    })
    .eq("id", id);

  if (error) {
    console.error("[zoho-import/store] updateBatch failed:", error.message);
    return false;
  }
  return true;
}

export interface StagedRecordInput {
  batchId: string;
  zohoRecordId: string;
  stage: ImportStage;
  status: ZohoCandidateImportRecordRow["status"];
  quarantineReasons?: string[];
  mappedPayload?: Record<string, unknown>;
  sourceFingerprint?: string | null;
  matchedCandidateId?: string | null;
  matchScore?: number | null;
  matchKind?: ZohoCandidateImportRecordRow["match_kind"];
  duplicateLinkId?: string | null;
  lastError?: string | null;
}

/** Insert or refresh one staged row. Idempotent on (batch, zoho record). */
export async function upsertStagedRecord(input: StagedRecordInput): Promise<boolean> {
  const client = atsServiceClient();
  if (!client) return false;

  const payload = {
    batch_id: input.batchId,
    zoho_record_id: input.zohoRecordId,
    stage: input.stage,
    status: input.status,
    quarantine_reasons: input.quarantineReasons ?? [],
    mapped_payload: input.mappedPayload ?? {},
    source_fingerprint: input.sourceFingerprint ?? null,
    matched_candidate_id: input.matchedCandidateId ?? null,
    match_score: input.matchScore ?? null,
    match_kind: input.matchKind ?? null,
    duplicate_link_id: input.duplicateLinkId ?? null,
    last_error: input.lastError ?? null,
  };

  const { error } = await client
    .from("zoho_candidate_import_records")
    .upsert(payload, { onConflict: "batch_id,zoho_record_id" });

  if (error) {
    console.error("[zoho-import/store] upsertStagedRecord failed:", error.message);
    return false;
  }
  return true;
}

export async function listBatchRecords(
  batchId: string,
  filter: { status?: ZohoCandidateImportRecordRow["status"] } = {},
  limit = 500,
): Promise<ZohoCandidateImportRecordRow[]> {
  const client = atsServiceClient();
  if (!client) return [];

  let query = client
    .from("zoho_candidate_import_records")
    .select("*")
    .eq("batch_id", batchId)
    .limit(limit);
  if (filter.status) query = query.eq("status", filter.status);

  const { data } = await query;
  return (data as ZohoCandidateImportRecordRow[] | null) ?? [];
}

/**
 * Record a human's decision on a staged row. `reviewedBy` is required by the
 * table's own CHECK constraint, so a decision with no named reviewer cannot be
 * stored at all.
 */
export async function recordHumanDecision(input: {
  recordId: string;
  decision: "create_new" | "link_existing" | "skip";
  reviewedBy: string;
  matchedCandidateId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = atsServiceClient();
  if (!client) return { ok: false, error: "Service role is not configured." };

  const { error } = await client
    .from("zoho_candidate_import_records")
    .update({
      decision: input.decision,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
      status: input.decision === "skip" ? "skipped" : "matched",
      ...(input.matchedCandidateId !== undefined
        ? { matched_candidate_id: input.matchedCandidateId }
        : {}),
    })
    .eq("id", input.recordId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Write the durable local↔Zoho mapping. This is the ONLY place an external id
 * is persisted beyond the life of a batch.
 */
export async function recordExternalMapping(input: {
  connectionId: string;
  candidateId: string;
  zohoRecordId: string;
  fingerprint: string | null;
}): Promise<boolean> {
  const client = createServiceRoleClient();
  if (!client) return false;

  const { error } = await client.from("zoho_recruit_external_mappings").upsert(
    {
      connection_id: input.connectionId,
      local_entity_type: "candidate_profile",
      local_entity_id: input.candidateId,
      zoho_module: "Candidates",
      zoho_record_id: input.zohoRecordId,
      sync_direction: "inbound",
      last_external_fingerprint: input.fingerprint,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,local_entity_type,local_entity_id" },
  );

  if (error) {
    console.error("[zoho-import/store] recordExternalMapping failed:", error.message);
    return false;
  }
  return true;
}

/** Discard a finished batch's staging rows. Mappings and candidates are untouched. */
export async function purgeBatchRecords(batchId: string): Promise<number> {
  const client = atsServiceClient();
  if (!client) return 0;
  const { data, error } = await client.rpc("purge_zoho_candidate_import_batch", {
    p_batch_id: batchId,
  });
  if (error) {
    console.error("[zoho-import/store] purgeBatchRecords failed:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
