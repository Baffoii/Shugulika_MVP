"use server";

/**
 * Merge-review server actions.
 *
 * Every action here is an explicit human decision recorded against a named
 * actor. There is deliberately no "merge all", no "auto-resolve", and no action
 * that acts on a score: the queue exists precisely because a score is not a
 * decision.
 *
 * Authorization is layered. These actions re-check the HQ portal, the RLS
 * policies on candidate_duplicate_links are HQ-only, and `apply_candidate_merge`
 * re-checks the role again inside the database. A bug in any one layer does not
 * open the others.
 *
 * Outcomes come back as a `?merge=<code>` redirect so the review screen stays a
 * plain server-rendered form — same pattern as the integrations screen.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePortal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { reviewDuplicateLink } from "@/lib/candidates/duplicate-store";
import { applyCandidateMerge, revertCandidateMerge } from "@/lib/candidates/merge-store";
import {
  MERGEABLE_PROFILE_FIELDS,
  type MergeableProfileField,
  type MergeFieldDecision,
  type MergeSide,
} from "@/lib/candidates/merge";

const QUEUE = "/hq/merge-review";

async function actingHqUserId(): Promise<string | null> {
  await requirePortal("hq");
  const { data } = await createClient().auth.getUser();
  return data.user?.id ?? null;
}

function backToPair(linkId: string | null, code: string, detail?: string): never {
  const params = new URLSearchParams({ merge: code });
  if (detail) params.set("detail", detail.slice(0, 300));
  redirect(linkId ? `${QUEUE}/${linkId}?${params}` : `${QUEUE}?${params}`);
}

/** Record that a reviewer looked at a pair and decided one way or the other. */
export async function reviewDuplicateAction(formData: FormData): Promise<void> {
  const actorId = await actingHqUserId();
  const linkId = String(formData.get("linkId") ?? "") || null;
  if (!actorId) backToPair(linkId, "not_signed_in");

  const verdict = String(formData.get("verdict") ?? "");
  if (!linkId) backToPair(null, "link_missing");
  if (verdict !== "confirmed_duplicate" && verdict !== "not_duplicate") {
    backToPair(linkId, "verdict_required");
  }

  const note = String(formData.get("note") ?? "").trim();
  const result = await reviewDuplicateLink(createClient(), {
    linkId,
    verdict,
    reviewedBy: actorId,
    note: note || null,
  });
  if (!result.ok) backToPair(linkId, "review_failed");

  revalidatePath(QUEUE);
  redirect(`${QUEUE}?merge=${verdict === "not_duplicate" ? "dismissed" : "confirmed"}`);
}

/**
 * Apply a merge.
 *
 * Field winners arrive as `decision:<field>` = primary | duplicate. A missing
 * decision is an error, not a default: `buildMergePlan` refuses to guess, and we
 * surface that rather than silently keeping the primary's value.
 */
export async function mergeCandidatesAction(formData: FormData): Promise<void> {
  const actorId = await actingHqUserId();
  const linkId = String(formData.get("linkId") ?? "") || null;
  if (!actorId) backToPair(linkId, "not_signed_in");

  const primaryCandidateId = String(formData.get("primaryCandidateId") ?? "");
  const duplicateCandidateId = String(formData.get("duplicateCandidateId") ?? "");
  if (!primaryCandidateId || !duplicateCandidateId) backToPair(linkId, "candidates_missing");

  // A merge moves someone's entire history onto another record. Typing the word
  // is a small, deliberate speed bump against a mis-click on a queue screen.
  if (
    String(formData.get("confirm") ?? "")
      .trim()
      .toLowerCase() !== "merge"
  ) {
    backToPair(linkId, "confirmation_required");
  }

  const decisions: MergeFieldDecision[] = [];
  for (const field of MERGEABLE_PROFILE_FIELDS) {
    const raw = formData.get(`decision:${field}`);
    if (raw == null) continue;
    const winner = String(raw);
    if (winner !== "primary" && winner !== "duplicate") continue;
    decisions.push({
      fieldPath: field as MergeableProfileField,
      winner: winner as MergeSide,
      chosenBy: actorId,
    });
  }

  const result = await applyCandidateMerge({
    primaryCandidateId,
    duplicateCandidateId,
    duplicateLinkId: linkId,
    decisions,
    performedBy: actorId,
  });
  if (!result.ok) backToPair(linkId, "merge_failed", result.error);

  revalidatePath(QUEUE);
  revalidatePath("/hq/data-quality");
  redirect(`${QUEUE}?merge=merged`);
}

/** Undo a merge from its audit row. */
export async function revertMergeAction(formData: FormData): Promise<void> {
  const actorId = await actingHqUserId();
  if (!actorId) backToPair(null, "not_signed_in");

  const mergeEventId = String(formData.get("mergeEventId") ?? "");
  if (!mergeEventId) backToPair(null, "merge_event_missing");

  const reason = String(formData.get("reason") ?? "").trim();
  // The reason is the whole point of a reversible audit: "why did we undo this"
  // is the question someone will ask in six months.
  if (!reason) backToPair(null, "revert_reason_required");

  const result = await revertCandidateMerge({ mergeEventId, revertedBy: actorId, reason });
  if (!result.ok) backToPair(null, "revert_failed", result.error);

  revalidatePath(QUEUE);
  revalidatePath("/hq/data-quality");
  redirect(`${QUEUE}?merge=reverted`);
}
