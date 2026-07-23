import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { stageByKey } from "@/lib/constants";
import { titleCase } from "@/lib/format";

const TONE_BY_STATUS: Record<string, BadgeTone> = {
  // application / submission / job
  draft: "neutral",
  submitted: "info",
  pending_approval: "warn",
  approved: "success",
  active: "success",
  advertised: "success",
  on_hold: "warn",
  paused: "warn",
  filled: "brand",
  closed: "neutral",
  cancelled: "neutral",
  consent_pending: "warn",
  viewed: "info",
  shortlisted: "success",
  interview_requested: "info",
  offered: "brand",
  rejected: "danger",
  withdrawn: "neutral",
  access_revoked: "danger",
  cv_review: "info",
  testing: "warn",
  test_review: "warn",
  interview_screening: "info",
  interview_review: "info",
  reference_checks: "neutral",
  client_submission: "success",
  offer: "brand",
  hired: "success",
  // offer
  preparing: "neutral",
  sent: "info",
  negotiating: "warn",
  accepted: "success",
  declined: "danger",
  expired: "neutral",
  // interview
  requested: "warn",
  scheduled: "info",
  confirmed: "success",
  completed: "brand",
  no_show: "danger",
  // invoice
  issued: "info",
  partially_paid: "warn",
  paid: "success",
  overdue: "danger",
  voided: "neutral",
  // verification / generic
  verified: "success",
  pending: "warn",
  // aptitude assessment assignment
  assigned: "info",
  opened: "info",
  in_progress: "warn",
  graded: "success",
  denied: "danger",
  // sourced contact disposition
  not_contacted: "neutral",
  contacted: "info",
  interested: "success",
};

export function statusTone(status: string): BadgeTone {
  return TONE_BY_STATUS[status] ?? "neutral";
}

/**
 * Muted worktool tones for audit-log action keys (e.g. job_order.approved_and_published).
 * Prefer semantic meaning over decoration.
 */
export function auditActionTone(action: string): BadgeTone {
  const key = action.toLowerCase();
  if (
    key.includes("denied") ||
    key.includes("rejected") ||
    key.includes("revoked") ||
    key.includes("failed")
  ) {
    return "danger";
  }
  if (key.includes("withdrawn") || key.includes("cancelled") || key.includes("expired")) {
    return "neutral";
  }
  if (
    key.includes("approved") ||
    key.includes("published") ||
    key.includes("hired") ||
    key.includes("graded") ||
    key.includes("created") ||
    key.includes("completed")
  ) {
    return "success";
  }
  if (
    key.includes("assigned") ||
    key.includes("submitted") ||
    key.includes("opened") ||
    key.includes("stage_changed") ||
    key.includes("notified")
  ) {
    return "info";
  }
  if (
    key.includes("review") ||
    key.includes("configured") ||
    key.includes("manual") ||
    key.includes("pending") ||
    key.includes("requested")
  ) {
    return "warn";
  }
  return "neutral";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone(status)}>{label ?? titleCase(status)}</Badge>;
}

/** Badge for a recruiter pipeline stage key. */
export function StageBadge({ stageKey }: { stageKey: string }) {
  const stage = stageByKey(stageKey);
  return <Badge tone={statusTone(stageKey)}>{stage?.label ?? titleCase(stageKey)}</Badge>;
}
