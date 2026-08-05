import "server-only";

/**
 * Persistence for suspected duplicate links and the HQ merge queue.
 *
 * Everything here runs on the caller's RLS-scoped client. The policies on
 * `candidate_duplicate_links` and `candidate_merge_events` are HQ-only, so a
 * recruiter, franchise admin, or employer calling these functions reads an
 * empty set and writes nothing — the boundary is the database's, not a check
 * that could be forgotten in a new call site.
 *
 * Detection writes `suspected` links only. Applying a merge lives in
 * `merge-store.ts`, behind an explicit human decision.
 */
import { asAtsClient, type CandidateDuplicateLinkRow } from "@/lib/candidates/db";
import {
  detectDuplicates,
  type CandidateForDedupe,
  type DuplicateLinkDraft,
} from "@/lib/candidates/dedupe";

type ClientLike = Parameters<typeof asAtsClient>[0];

export interface DuplicateQueueItem {
  id: string;
  candidateIdLow: string;
  candidateIdHigh: string;
  status: CandidateDuplicateLinkRow["status"];
  matchKind: CandidateDuplicateLinkRow["match_kind"];
  score: number;
  signals: CandidateDuplicateLinkRow["signals"];
  detectedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

function toQueueItem(row: CandidateDuplicateLinkRow): DuplicateQueueItem {
  return {
    id: row.id,
    candidateIdLow: row.candidate_id_low,
    candidateIdHigh: row.candidate_id_high,
    status: row.status,
    matchKind: row.match_kind,
    score: Number(row.score),
    signals: Array.isArray(row.signals) ? row.signals : [],
    detectedAt: row.detected_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
  };
}

/** Unresolved pairs, strongest first. */
export async function listSuspectedDuplicates(
  client: ClientLike,
  limit = 100,
): Promise<DuplicateQueueItem[]> {
  const { data, error } = await asAtsClient(client)
    .from("candidate_duplicate_links")
    .select("*")
    .eq("status", "suspected")
    .order("score", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[duplicate-store] list failed:", error.message);
    return [];
  }
  return (data ?? []).map(toQueueItem);
}

export async function getDuplicateLink(
  client: ClientLike,
  id: string,
): Promise<DuplicateQueueItem | null> {
  const { data, error } = await asAtsClient(client)
    .from("candidate_duplicate_links")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toQueueItem(data);
}

export async function countDuplicatesByStatus(
  client: ClientLike,
): Promise<Record<CandidateDuplicateLinkRow["status"], number>> {
  const counts: Record<CandidateDuplicateLinkRow["status"], number> = {
    suspected: 0,
    confirmed_duplicate: 0,
    not_duplicate: 0,
    merged: 0,
  };

  const { data, error } = await asAtsClient(client)
    .from("candidate_duplicate_links")
    .select("status");
  if (error || !data) return counts;

  for (const row of data) {
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

/**
 * Persist detected pairs.
 *
 * Existing rows are left alone: a pair a reviewer already dismissed as
 * `not_duplicate` must not silently return to the queue because the detector ran
 * again. Only genuinely new pairs are inserted, always as `suspected`.
 */
export async function saveDetectedDuplicates(
  client: ClientLike,
  drafts: readonly DuplicateLinkDraft[],
): Promise<{ inserted: number; alreadyKnown: number; failed: number }> {
  if (drafts.length === 0) return { inserted: 0, alreadyKnown: 0, failed: 0 };
  const ats = asAtsClient(client);

  const { data: existing } = await ats
    .from("candidate_duplicate_links")
    .select("candidate_id_low,candidate_id_high");
  const known = new Set(
    (existing ?? []).map((row) => `${row.candidate_id_low}|${row.candidate_id_high}`),
  );

  let inserted = 0;
  let alreadyKnown = 0;
  let failed = 0;

  for (const draft of drafts) {
    const key = `${draft.candidateIdLow}|${draft.candidateIdHigh}`;
    if (known.has(key)) {
      alreadyKnown += 1;
      continue;
    }
    const { error } = await ats.from("candidate_duplicate_links").insert({
      candidate_id_low: draft.candidateIdLow,
      candidate_id_high: draft.candidateIdHigh,
      status: "suspected",
      match_kind: draft.matchKind,
      score: draft.score,
      signals: draft.signals,
      detector_version: draft.detectorVersion,
    });
    if (error) {
      console.error("[duplicate-store] insert failed:", error.message);
      failed += 1;
      continue;
    }
    known.add(key);
    inserted += 1;
  }

  return { inserted, alreadyKnown, failed };
}

/**
 * Run detection over a pool and persist what it finds. Returns the counts only
 * — the caller (a worker or the HQ page) never needs the drafts themselves.
 */
export async function runDuplicateDetection(
  client: ClientLike,
  pool: readonly CandidateForDedupe[],
): Promise<{ pairsFound: number; inserted: number; alreadyKnown: number; failed: number }> {
  const drafts = detectDuplicates(pool);
  const saved = await saveDetectedDuplicates(client, drafts);
  return { pairsFound: drafts.length, ...saved };
}

/**
 * Record a reviewer's verdict on a pair. `merged` is deliberately not accepted
 * here: a link only becomes `merged` as part of applying an audited merge.
 */
export async function reviewDuplicateLink(
  client: ClientLike,
  input: {
    linkId: string;
    verdict: "confirmed_duplicate" | "not_duplicate";
    reviewedBy: string;
    note?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await asAtsClient(client)
    .from("candidate_duplicate_links")
    .update({
      status: input.verdict,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: input.note ?? null,
    })
    .eq("id", input.linkId)
    .eq("status", "suspected");

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
