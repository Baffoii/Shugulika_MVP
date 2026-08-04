import "server-only";

import {
  buildCandidateFieldMapping,
  zohoListFields,
  type CandidateFieldMapping,
  type ZohoFieldMeta,
} from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { normalizeZohoCandidateRecord } from "@/lib/integrations/zoho-recruit/candidate-normalize";
import { probeZohoCandidateAccess } from "@/lib/integrations/zoho-recruit/candidate-probe";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { getFields, listRecords } from "@/lib/integrations/zoho-recruit/records";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type CandidateSyncResult = {
  skipped?: boolean;
  reason?: string;
  runId?: string;
  status: "succeeded" | "failed" | "skipped";
  pagesFetched: number;
  candidatesSeen: number;
  candidatesUpserted: number;
  candidatesInactivated: number;
  errorSummary?: string;
};

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

function parseFieldsPayload(payload: unknown): ZohoFieldMeta[] {
  if (!payload || typeof payload !== "object" || !("fields" in payload)) return [];
  const fields = (payload as { fields: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  const parsed: ZohoFieldMeta[] = [];
  for (const row of fields) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    if (typeof obj.api_name !== "string" || !obj.api_name.trim()) continue;
    parsed.push({
      api_name: obj.api_name,
      field_label: typeof obj.field_label === "string" ? obj.field_label : undefined,
      data_type: typeof obj.data_type === "string" ? obj.data_type : undefined,
    });
  }
  return parsed;
}

function parseListPage(payload: unknown): {
  records: unknown[];
  moreRecords: boolean;
} {
  if (!payload || typeof payload !== "object") return { records: [], moreRecords: false };
  const obj = payload as { data?: unknown; info?: { more_records?: unknown } };
  const records = Array.isArray(obj.data) ? obj.data : [];
  const moreRecords = obj.info?.more_records === true;
  return { records, moreRecords };
}

async function tryAcquireSyncLock(runId: string, lockedBy: string): Promise<boolean> {
  const client = requireServiceClient();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("zoho_recruit_candidate_sync_lock")
    .update({
      run_id: runId,
      locked_at: now.toISOString(),
      locked_by: lockedBy,
    } as never)
    .eq("lock_key", "primary")
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select("lock_key")
    .maybeSingle();
  if (error) throw new Error("Could not acquire candidate sync lock.");
  return Boolean(data);
}

async function releaseSyncLock(runId: string): Promise<void> {
  const client = requireServiceClient();
  await client
    .from("zoho_recruit_candidate_sync_lock")
    .update({ run_id: null, locked_at: null, locked_by: null } as never)
    .eq("lock_key", "primary")
    .eq("run_id", runId);
}

export async function loadCandidateFieldMapping(): Promise<CandidateFieldMapping> {
  const result = await getFields("Candidates");
  return buildCandidateFieldMapping(parseFieldsPayload(result.data));
}

/**
 * Idempotent inbound sync: paginate Zoho Candidates, normalize, upsert by zoho_candidate_id,
 * soft-inactivate rows no longer returned/eligible. Read-only toward Zoho.
 */
export async function syncZohoCandidatesToSearchCache(options?: {
  lockedBy?: string;
}): Promise<CandidateSyncResult> {
  const lockedBy = options?.lockedBy ?? "hq_sync";
  const gates = await getZohoRecruitGateStatus();
  if (!gates.syncAllowed) {
    return {
      skipped: true,
      status: "skipped",
      reason: gates.blockedReasons.join("; ") || "sync gates disabled",
      pagesFetched: 0,
      candidatesSeen: 0,
      candidatesUpserted: 0,
      candidatesInactivated: 0,
    };
  }
  if (!gates.productionExportAllowed && !gates.sandboxExportAllowed) {
    return {
      skipped: true,
      status: "skipped",
      reason:
        "neither zoho_recruit_production_data_enabled nor zoho_recruit_sandbox_sync_enabled is on",
      pagesFetched: 0,
      candidatesSeen: 0,
      candidatesUpserted: 0,
      candidatesInactivated: 0,
    };
  }

  const probe = await probeZohoCandidateAccess();
  if (!probe.ready) {
    return {
      skipped: true,
      status: "skipped",
      reason: probe.checks
        .filter((c) => !c.ok)
        .map((c) => c.detail)
        .join("; "),
      pagesFetched: 0,
      candidatesSeen: 0,
      candidatesUpserted: 0,
      candidatesInactivated: 0,
    };
  }

  const client = requireServiceClient();
  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("id")
    .eq("connection_key", "primary")
    .maybeSingle();
  if (!connection) {
    return {
      skipped: true,
      status: "skipped",
      reason: "connection_missing",
      pagesFetched: 0,
      candidatesSeen: 0,
      candidatesUpserted: 0,
      candidatesInactivated: 0,
    };
  }

  const { data: run, error: runError } = await client
    .from("zoho_recruit_candidate_sync_runs")
    .insert({
      connection_id: (connection as { id: string }).id,
      status: "running",
      metadata: { locked_by: lockedBy },
    } as never)
    .select("id")
    .single();
  if (runError || !run) throw new Error("Could not create candidate sync run.");
  const runId = (run as { id: string }).id;

  const locked = await tryAcquireSyncLock(runId, lockedBy);
  if (!locked) {
    await client
      .from("zoho_recruit_candidate_sync_runs")
      .update({
        status: "skipped",
        finished_at: new Date().toISOString(),
        error_summary: "another_sync_in_progress",
      } as never)
      .eq("id", runId);
    return {
      skipped: true,
      status: "skipped",
      reason: "another_sync_in_progress",
      runId,
      pagesFetched: 0,
      candidatesSeen: 0,
      candidatesUpserted: 0,
      candidatesInactivated: 0,
    };
  }

  let pagesFetched = 0;
  let candidatesSeen = 0;
  let candidatesUpserted = 0;
  let candidatesInactivated = 0;

  try {
    const mapping = await loadCandidateFieldMapping();
    const fields = zohoListFields(mapping);
    const seenIds = new Set<string>();
    let page = 1;
    let more = true;

    while (more) {
      const list = await listRecords("Candidates", {
        page,
        per_page: 200,
        fields,
      });
      const parsed = parseListPage(list.data);
      pagesFetched += 1;
      candidatesSeen += parsed.records.length;

      const rows = parsed.records
        .map((raw) => normalizeZohoCandidateRecord(raw, mapping))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      const now = new Date().toISOString();
      const upserts = rows.map((row) => {
        seenIds.add(row.zohoCandidateId);
        return {
          zoho_candidate_id: row.zohoCandidateId,
          teaser_label: row.teaserLabel,
          full_name: row.fullName,
          given_name: row.givenName,
          family_name: row.familyName,
          email: row.email,
          phone: row.phone,
          job_title: row.jobTitle,
          employer_or_industry: row.employerOrIndustry,
          industry: row.industry,
          skills: row.skills,
          years_experience: row.yearsExperience,
          qualification: row.qualification,
          city: row.city,
          country: row.country,
          country_code: row.countryCode,
          candidate_status: row.candidateStatus,
          availability: row.availability,
          has_resume: row.hasResume,
          zoho_attachment_id: row.zohoAttachmentId,
          search_eligible: row.searchEligible,
          consent_or_visibility: row.consentOrVisibility,
          zoho_created_at: row.zohoCreatedAt,
          zoho_modified_at: row.zohoModifiedAt,
          synced_at: now,
          is_active: row.searchEligible,
        };
      });

      if (upserts.length > 0) {
        const { error } = await client
          .from("zoho_recruit_candidate_search")
          .upsert(upserts as never, { onConflict: "zoho_candidate_id" });
        if (error) throw new Error("Candidate search upsert failed.");
        candidatesUpserted += upserts.length;
      }

      more = parsed.moreRecords;
      page += 1;
      if (page > 500) throw new Error("Candidate sync exceeded page safety limit.");
    }

    // Soft-inactivate previously synced rows that disappeared or became ineligible.
    const { data: existing } = await client
      .from("zoho_recruit_candidate_search")
      .select("zoho_candidate_id")
      .eq("is_active", true);
    const toInactivate = ((existing as Array<{ zoho_candidate_id: string }> | null) ?? [])
      .map((r) => r.zoho_candidate_id)
      .filter((id) => !seenIds.has(id));

    if (toInactivate.length > 0) {
      const { error } = await client
        .from("zoho_recruit_candidate_search")
        .update({
          is_active: false,
          search_eligible: false,
          synced_at: new Date().toISOString(),
        } as never)
        .in("zoho_candidate_id", toInactivate);
      if (error) throw new Error("Candidate inactivation failed.");
      candidatesInactivated = toInactivate.length;
    }

    await client
      .from("zoho_recruit_candidate_sync_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        pages_fetched: pagesFetched,
        candidates_seen: candidatesSeen,
        candidates_upserted: candidatesUpserted,
        candidates_inactivated: candidatesInactivated,
        error_summary: null,
        metadata: {
          locked_by: lockedBy,
          field_count: fields.length,
        },
      } as never)
      .eq("id", runId);

    return {
      status: "succeeded",
      runId,
      pagesFetched,
      candidatesSeen,
      candidatesUpserted,
      candidatesInactivated,
    };
  } catch (error) {
    const summary = error instanceof Error ? error.message.slice(0, 500) : "candidate_sync_failed";
    console.error("[zoho-recruit/candidate-sync]", summary);
    await client
      .from("zoho_recruit_candidate_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        pages_fetched: pagesFetched,
        candidates_seen: candidatesSeen,
        candidates_upserted: candidatesUpserted,
        candidates_inactivated: candidatesInactivated,
        error_summary: summary,
      } as never)
      .eq("id", runId);
    return {
      status: "failed",
      runId,
      pagesFetched,
      candidatesSeen,
      candidatesUpserted,
      candidatesInactivated,
      errorSummary: summary,
    };
  } finally {
    await releaseSyncLock(runId);
  }
}
