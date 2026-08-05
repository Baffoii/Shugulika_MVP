/**
 * Outcome messages for the merge-review screens.
 *
 * Kept as data so both the queue and the pair screen say the same thing about
 * the same outcome, and so a failure reads as an explanation rather than a
 * status code.
 */
export type MergeStatusTone = "success" | "warn" | "danger" | "info";

export const MERGE_STATUS_MESSAGES: Record<
  string,
  { tone: MergeStatusTone; title: string; text: string }
> = {
  merged: {
    tone: "success",
    title: "Records merged",
    text: "The duplicate record is archived and its history moved across. This merge is reversible from the history below.",
  },
  confirmed: {
    tone: "success",
    title: "Confirmed as duplicates",
    text: "The pair stays in the queue until someone merges it — confirming is not merging.",
  },
  dismissed: {
    tone: "success",
    title: "Marked as different people",
    text: "Detection will not re-report this pair.",
  },
  reverted: {
    tone: "success",
    title: "Merge reverted",
    text: "Both records are back as they were, and the pair has returned to the review queue.",
  },
  not_signed_in: {
    tone: "danger",
    title: "Not signed in",
    text: "A merge has to be recorded against a named person. Sign in again and retry.",
  },
  link_missing: {
    tone: "warn",
    title: "No pair selected",
    text: "Open a pair from the queue before reviewing it.",
  },
  verdict_required: {
    tone: "warn",
    title: "Choose a verdict",
    text: "Say whether these are the same person or two different people.",
  },
  candidates_missing: {
    tone: "warn",
    title: "Both records are required",
    text: "The merge form did not carry both candidate ids. Reopen the pair and try again.",
  },
  confirmation_required: {
    tone: "warn",
    title: "Confirm the merge",
    text: 'Type "merge" in the confirmation box. A merge moves a person\'s entire history onto another record.',
  },
  merge_failed: {
    tone: "danger",
    title: "The merge did not run",
    text: "Nothing was changed. Every conflicting field needs a decision before a merge can be applied.",
  },
  review_failed: {
    tone: "danger",
    title: "Could not record that review",
    text: "The pair is unchanged. It may have already been reviewed by someone else.",
  },
  merge_event_missing: {
    tone: "warn",
    title: "No merge selected",
    text: "Pick a merge from the history to revert.",
  },
  revert_reason_required: {
    tone: "warn",
    title: "A reason is required",
    text: "Say why this merge is being reverted — it goes into the audit trail.",
  },
  revert_failed: {
    tone: "danger",
    title: "The revert did not run",
    text: "Nothing was changed. The merge may already have been reverted.",
  },
};
