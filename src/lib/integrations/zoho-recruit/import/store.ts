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
import { isWaivable } from "@/lib/integrations/zoho-recruit/import/quarantine";
import type { QuarantineReason } from "@/lib/candidates/constants";

function atsServiceClient() {
  const client = createServiceRoleClient();
  return client ? asAtsClient(client) : null;
}

function requireAtsServiceClient() {
  const client = atsServiceClient();
  if (!client)
    throw new Error("Zoho import persistence is unavailable: service role is not configured.");
  return client;
}

function persistenceError(operation: string, message: string): Error {
  return new Error(`Zoho import persistence failed during ${operation}: ${message}`);
}

export interface CreateBatchInput {
  connectionId: string;
  requestedBy: string | null;
  isDryRun: boolean;
  sourceModule?: string;
}

export async function createImportBatch(
  input: CreateBatchInput,
): Promise<ZohoCandidateImportBatchRow> {
  const client = requireAtsServiceClient();

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
    throw persistenceError("createImportBatch", error.message);
  }
  return data as ZohoCandidateImportBatchRow;
}

export async function getImportBatch(id: string): Promise<ZohoCandidateImportBatchRow | null> {
  const client = requireAtsServiceClient();
  const { data, error } = await client
    .from("zoho_candidate_import_batches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw persistenceError("getImportBatch", error.message);
  return (data as ZohoCandidateImportBatchRow | null) ?? null;
}

export async function listRecentBatches(limit = 20): Promise<ZohoCandidateImportBatchRow[]> {
  const client = requireAtsServiceClient();
  const { data, error } = await client
    .from("zoho_candidate_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw persistenceError("listRecentBatches", error.message);
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
): Promise<void> {
  const client = requireAtsServiceClient();

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
    throw persistenceError("updateBatch", error.message);
  }
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
export async function upsertStagedRecord(input: StagedRecordInput): Promise<void> {
  const client = requireAtsServiceClient();

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
    throw persistenceError("upsertStagedRecord", error.message);
  }
}

export async function listBatchRecords(
  batchId: string,
  filter: { status?: ZohoCandidateImportRecordRow["status"] } = {},
): Promise<ZohoCandidateImportRecordRow[]> {
  const client = requireAtsServiceClient();
  const records: ZohoCandidateImportRecordRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = client
      .from("zoho_candidate_import_records")
      .select("*")
      .eq("batch_id", batchId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (filter.status) query = query.eq("status", filter.status);
    const { data, error } = await query;
    if (error) throw persistenceError("listBatchRecords", error.message);
    const page = (data as ZohoCandidateImportRecordRow[] | null) ?? [];
    records.push(...page);
    if (page.length < pageSize) return records;
  }
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
}): Promise<void> {
  const client = requireAtsServiceClient();
  if (input.decision === "link_existing" && !input.matchedCandidateId) {
    throw new Error("Choose the existing candidate to link.");
  }

  const { data: record, error: loadError } = await client
    .from("zoho_candidate_import_records")
    .select("batch_id,status,quarantine_reasons")
    .eq("id", input.recordId)
    .maybeSingle();
  if (loadError) throw persistenceError("recordHumanDecision.load", loadError.message);
  if (!record) throw new Error("The staged import record no longer exists.");
  if (record.status !== "needs_human_review" && record.status !== "quarantined") {
    throw new Error("This record is not awaiting a human decision.");
  }
  const { data: batch, error: batchError } = await client
    .from("zoho_candidate_import_batches")
    .select("stage,status")
    .eq("id", record.batch_id)
    .maybeSingle();
  if (batchError) throw persistenceError("recordHumanDecision.batch", batchError.message);
  if (!batch || batch.stage !== "human_review" || batch.status === "completed") {
    throw new Error("Review decisions are accepted only while the batch is at human review.");
  }
  if (
    record.status === "quarantined" &&
    input.decision !== "skip" &&
    !isWaivable(record.quarantine_reasons as QuarantineReason[])
  ) {
    throw new Error("This quarantine reason cannot be overridden; correct the source or skip it.");
  }

  const { error } = await client
    .from("zoho_candidate_import_records")
    .update({
      decision: input.decision,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
      status: input.decision === "skip" ? "skipped" : "matched",
      matched_candidate_id:
        input.decision === "create_new" ? null : (input.matchedCandidateId ?? null),
    })
    .eq("id", input.recordId);

  if (error) throw persistenceError("recordHumanDecision", error.message);
}

export async function getReconciliationTarget(input: {
  connectionId: string;
  zohoRecordId: string;
}): Promise<{
  candidateId: string;
  fingerprint: string | null;
  mergedIntoCandidateId: string | null;
} | null> {
  const client = createServiceRoleClient();
  if (!client)
    throw new Error("Zoho import persistence is unavailable: service role is not configured.");
  const { data: mapping, error: mappingError } = await client
    .from("zoho_recruit_external_mappings")
    .select("local_entity_id,last_external_fingerprint")
    .eq("connection_id", input.connectionId)
    .eq("zoho_module", "Candidates")
    .eq("zoho_record_id", input.zohoRecordId)
    .maybeSingle();
  if (mappingError) throw persistenceError("reconcile.mapping", mappingError.message);
  if (!mapping) return null;
  const { data: candidate, error: candidateError } = await asAtsClient(client)
    .from("candidate_profiles")
    .select("id,merged_into_candidate_id")
    .eq("id", mapping.local_entity_id)
    .maybeSingle();
  if (candidateError) throw persistenceError("reconcile.candidate", candidateError.message);
  if (!candidate) return null;
  return {
    candidateId: candidate.id,
    fingerprint: mapping.last_external_fingerprint,
    mergedIntoCandidateId: candidate.merged_into_candidate_id,
  };
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
}): Promise<void> {
  const client = createServiceRoleClient();
  if (!client)
    throw new Error("Zoho import persistence is unavailable: service role is not configured.");

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
    { onConflict: "connection_id,zoho_module,zoho_record_id" },
  );

  if (error) {
    throw persistenceError("recordExternalMapping", error.message);
  }
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
