import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/database.types";
import type { AssessmentResultSnapshot, ResultVisibilityTier } from "@/lib/candidate/types";

const FORBIDDEN_RESULT_KEYS = new Set([
  "recruiter_notes",
  "recruiter_note",
  "internal_notes",
  "grading_notes",
  "ai_review",
  "ai_confidence",
  "employer_deliberation",
  "rejection_reason",
  "responses",
]);

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defense in depth for already-permitted snapshots. Visibility is enforced from
 * the stored tier, and internal/provider-only keys are removed recursively.
 */
export function permittedCandidatePayload(payload: Json, tier: ResultVisibilityTier): Json {
  if (tier === "completion_only") return { completion_status: "completed" };
  if (!isRecord(payload)) return {};

  const clean = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(clean);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !FORBIDDEN_RESULT_KEYS.has(key))
        .map(([key, nested]) => [key, clean(nested ?? null)]),
    );
  };

  const cleaned = clean(payload);
  if (tier === "candidate_full" || !isRecord(cleaned)) return cleaned;
  const limitedKeys = new Set(["completion_status", "score_percent", "result_band", "summary"]);
  return Object.fromEntries(Object.entries(cleaned).filter(([key]) => limitedKeys.has(key)));
}

/** Read only the verified, candidate-owned snapshot. No provider call is made. */
export async function readCandidateResultSnapshot(
  client: SupabaseClient,
  candidateId: string,
  assignmentId: string,
): Promise<AssessmentResultSnapshot | null> {
  const { data: assignment } = await client
    .from("assessment_assignments")
    .select("id,candidate_id")
    .eq("id", assignmentId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (!assignment) return null;

  const { data } = await client
    .from("assessment_result_snapshots")
    .select("assignment_id,provider,permitted_payload,visibility_tier,captured_at")
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (!data) return null;

  const row = data as AssessmentResultSnapshot;
  return {
    ...row,
    permitted_payload: permittedCandidatePayload(row.permitted_payload, row.visibility_tier),
  };
}
