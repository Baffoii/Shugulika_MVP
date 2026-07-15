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
};

export function statusTone(status: string): BadgeTone {
  return TONE_BY_STATUS[status] ?? "neutral";
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone(status)}>{label ?? titleCase(status)}</Badge>;
}

/** Badge for a recruiter pipeline stage key. */
export function StageBadge({ stageKey }: { stageKey: string }) {
  const stage = stageByKey(stageKey);
  return <Badge tone={statusTone(stageKey)}>{stage?.label ?? titleCase(stageKey)}</Badge>;
}
