import type { JobOrderOrigin } from "@/lib/jobs/types";

export function canStaffApproveByShugulika(status: string, origin: JobOrderOrigin): boolean {
  if (origin === "employer_online") return status === "submitted_to_shugulika";
  return status === "approved_by_employer";
}

export function canEmployerApprove(status: string, origin: JobOrderOrigin): boolean {
  return origin === "shugulika_offline" && status === "awaiting_employer_approval";
}

export function canStaffPublish(status: string, origin: JobOrderOrigin): boolean {
  if (origin === "employer_online") return status === "approved_by_shugulika";
  return status === "approved_by_employer" || status === "approved_by_shugulika";
}

export function canStaffRequestChanges(status: string): boolean {
  return [
    "submitted_to_shugulika",
    "awaiting_employer_approval",
    "approved_by_employer",
    "approved_by_shugulika",
  ].includes(status);
}

export function canStaffSubmitOffline(status: string, origin: JobOrderOrigin): boolean {
  return origin === "shugulika_offline" && (status === "draft" || status === "changes_requested");
}

export function canEmployerSubmitOnline(status: string, origin: JobOrderOrigin): boolean {
  return origin === "employer_online" && (status === "draft" || status === "changes_requested");
}

export function reapprovalStatusForOrigin(origin: JobOrderOrigin): string {
  return origin === "shugulika_offline" ? "awaiting_employer_approval" : "submitted_to_shugulika";
}

export function jobOrderStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}
