import "server-only";

/**
 * Loading merge candidates and applying merges.
 *
 * The merge itself is a single `apply_candidate_merge` RPC rather than a series
 * of client writes, for two reasons: it has to be atomic (a half-applied merge
 * splits a person's history across two records), and HQ intentionally has no
 * UPDATE grant on candidate tables — a candidate owns their own record. The RPC
 * re-checks the HQ role and the actor itself, so nothing here is load-bearing
 * for authorization.
 */
import { asAtsClient, type CandidateMergeEventRow } from "@/lib/candidates/db";
import { loadCandidateProvenance } from "@/lib/candidates/provenance-store";
import {
  buildMergeConflicts,
  buildMergePlan,
  buildRevertPlan,
  MergeNotPermittedError,
  type MergeableProfile,
  type MergeFieldConflict,
  type MergeFieldDecision,
  type MergeSnapshot,
} from "@/lib/candidates/merge";
import type { ProvenanceRecord } from "@/lib/candidates/provenance";
import { createClient } from "@/lib/supabase/server";

type ClientLike = Parameters<typeof asAtsClient>[0];

export interface MergeChildInventory {
  experiences: string[];
  education: string[];
  skills: string[];
  certifications: string[];
  languages: string[];
  documents: string[];
  applications: string[];
  externalMappings: string[];
}

export interface MergeReviewPair {
  primary: MergeableProfile;
  duplicate: MergeableProfile;
  conflicts: MergeFieldConflict[];
  provenance: ProvenanceRecord[];
  duplicateChildRows: MergeChildInventory;
  primaryChildCounts: Record<keyof MergeChildInventory, number>;
}

const PROFILE_COLUMNS =
  "id,given_name,middle_name,family_name,contact_email,headline,summary,city,country_code,date_of_birth,availability";

async function loadProfile(candidateId: string): Promise<MergeableProfile | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", candidateId)
    .maybeSingle();
  return (data as MergeableProfile | null) ?? null;
}

/** Tables whose rows a merge re-points from the duplicate onto the survivor. */
type ChildTable =
  | "candidate_experiences"
  | "candidate_education"
  | "candidate_skills"
  | "candidate_certifications"
  | "candidate_languages"
  | "candidate_documents"
  | "applications";

async function childIds(candidateId: string): Promise<MergeChildInventory> {
  const supabase = createClient();
  const pick = async (table: ChildTable): Promise<string[]> => {
    const { data } = await supabase.from(table).select("id").eq("candidate_id", candidateId);
    return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  };

  // Listed explicitly rather than mapped over CHILD_TABLES so the destructured
  // results stay a typed tuple instead of a possibly-short array.
  const [experiences, education, skills, certifications, languages, documents, applications] =
    await Promise.all([
      pick("candidate_experiences"),
      pick("candidate_education"),
      pick("candidate_skills"),
      pick("candidate_certifications"),
      pick("candidate_languages"),
      pick("candidate_documents"),
      pick("applications"),
    ]);

  // External mappings live in the server-only Zoho ledger; HQ's browser client
  // cannot read them, so they are inventoried as empty here and reconciled by
  // the import worker instead.
  return {
    experiences,
    education,
    skills,
    certifications,
    languages,
    documents,
    applications,
    externalMappings: [],
  };
}

/** Everything the merge-review screen needs for one pair. */
export async function loadMergeReviewPair(
  primaryId: string,
  duplicateId: string,
): Promise<MergeReviewPair | null> {
  const supabase = createClient();
  const [primary, duplicate] = await Promise.all([
    loadProfile(primaryId),
    loadProfile(duplicateId),
  ]);
  if (!primary || !duplicate) return null;

  const [primaryProvenance, duplicateProvenance, duplicateChildRows, primaryChildRows] =
    await Promise.all([
      loadCandidateProvenance(supabase, primaryId),
      loadCandidateProvenance(supabase, duplicateId),
      childIds(duplicateId),
      childIds(primaryId),
    ]);

  const provenance = [...primaryProvenance, ...duplicateProvenance];

  return {
    primary,
    duplicate,
    conflicts: buildMergeConflicts(primary, duplicate, provenance),
    provenance,
    duplicateChildRows,
    primaryChildCounts: {
      experiences: primaryChildRows.experiences.length,
      education: primaryChildRows.education.length,
      skills: primaryChildRows.skills.length,
      certifications: primaryChildRows.certifications.length,
      languages: primaryChildRows.languages.length,
      documents: primaryChildRows.documents.length,
      applications: primaryChildRows.applications.length,
      externalMappings: primaryChildRows.externalMappings.length,
    },
  };
}

export type MergeOutcome = { ok: true; mergeEventId: string } | { ok: false; error: string };

/**
 * Apply a reviewer's decisions. `performedBy` must be the acting HQ user; the
 * plan builder rejects a missing actor or an undecided conflict before anything
 * reaches the database.
 */
export async function applyCandidateMerge(input: {
  primaryCandidateId: string;
  duplicateCandidateId: string;
  duplicateLinkId: string | null;
  decisions: MergeFieldDecision[];
  performedBy: string;
}): Promise<MergeOutcome> {
  const pair = await loadMergeReviewPair(input.primaryCandidateId, input.duplicateCandidateId);
  if (!pair) return { ok: false, error: "One of these candidate records could not be loaded." };

  let plan;
  try {
    plan = buildMergePlan({
      primary: pair.primary,
      duplicate: pair.duplicate,
      decisions: input.decisions,
      provenance: pair.provenance,
      duplicateChildRows: pair.duplicateChildRows,
      duplicateLinkId: input.duplicateLinkId,
      performedBy: input.performedBy,
      performedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof MergeNotPermittedError) return { ok: false, error: error.message };
    throw error;
  }

  const { data, error } = await asAtsClient(createClient()).rpc("apply_candidate_merge", {
    p_primary_candidate_id: plan.primaryCandidateId,
    p_merged_candidate_id: plan.mergedCandidateId,
    p_duplicate_link_id: plan.duplicateLinkId,
    p_field_decisions: plan.fieldDecisions as unknown as Record<string, unknown>[],
    p_profile_updates: plan.profileUpdates as Record<string, unknown>,
    p_before_snapshot: plan.beforeSnapshot as unknown as Record<string, unknown>,
  });

  if (error) {
    console.error("[merge-store] apply_candidate_merge failed:", error.message);
    return { ok: false, error: "The merge could not be completed. No records were changed." };
  }
  return { ok: true, mergeEventId: String(data) };
}

/** Undo a merge from its audit row alone. */
export async function revertCandidateMerge(input: {
  mergeEventId: string;
  revertedBy: string;
  reason: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ats = asAtsClient(createClient());
  const { data, error: loadError } = await ats
    .from("candidate_merge_events")
    .select("*")
    .eq("id", input.mergeEventId)
    .maybeSingle();

  if (loadError || !data) return { ok: false, error: "That merge could not be found." };
  const event = data as CandidateMergeEventRow;
  if (event.status !== "merged") return { ok: false, error: "That merge was already reverted." };

  let plan;
  try {
    plan = buildRevertPlan({
      primaryCandidateId: event.primary_candidate_id,
      mergedCandidateId: event.merged_candidate_id,
      beforeSnapshot: event.before_snapshot as unknown as MergeSnapshot,
      fieldDecisions: (event.field_decisions ?? []) as unknown as ReturnType<
        typeof buildMergePlan
      >["fieldDecisions"],
      revertedBy: input.revertedBy,
      revertedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof MergeNotPermittedError) return { ok: false, error: error.message };
    throw error;
  }

  const { error } = await ats.rpc("revert_candidate_merge", {
    p_merge_event_id: input.mergeEventId,
    p_profile_restores: plan.profileRestores as Record<string, unknown>,
    p_reason: input.reason,
  });

  if (error) {
    console.error("[merge-store] revert_candidate_merge failed:", error.message);
    return { ok: false, error: "The merge could not be reverted. No records were changed." };
  }
  return { ok: true };
}

export interface MergeHistoryItem {
  id: string;
  primaryCandidateId: string;
  mergedCandidateId: string;
  status: "merged" | "reverted";
  performedBy: string;
  performedAt: string;
  revertedAt: string | null;
  revertReason: string | null;
  decidedFieldCount: number;
}

export async function listMergeHistory(
  client: ClientLike,
  limit = 50,
): Promise<MergeHistoryItem[]> {
  const { data, error } = await asAtsClient(client)
    .from("candidate_merge_events")
    .select("*")
    .order("performed_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    primaryCandidateId: row.primary_candidate_id,
    mergedCandidateId: row.merged_candidate_id,
    status: row.status,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
    revertedAt: row.reverted_at,
    revertReason: row.revert_reason,
    decidedFieldCount: Array.isArray(row.field_decisions) ? row.field_decisions.length : 0,
  }));
}
