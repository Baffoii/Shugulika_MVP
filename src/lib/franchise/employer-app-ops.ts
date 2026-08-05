import type { EmployerAppNextAction } from "@/lib/franchise/types";

export function applicationAgeHours(
  submittedAt: string | null | undefined,
  now = new Date(),
): number | null {
  if (!submittedAt) return null;
  const ms = now.getTime() - new Date(submittedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.round((ms / (60 * 60 * 1000)) * 10) / 10;
}

export function isSlaOverdue(
  slaDueAt: string | null | undefined,
  status: string,
  now = new Date(),
): boolean {
  if (!slaDueAt) return false;
  if (!["submitted", "under_review"].includes(status)) return false;
  return new Date(slaDueAt).getTime() < now.getTime();
}

export function defaultNextActionForStatus(status: string): EmployerAppNextAction {
  switch (status) {
    case "submitted":
      return "open_review";
    case "under_review":
      return "decide";
    case "changes_requested":
      return "await_employer";
    case "approved":
    case "rejected":
      return "close_out";
    default:
      return "none";
  }
}

/** Sanitize error text so foreign org identifiers never leak across franchises. */
export function sanitizeFranchiseError(message: string | null | undefined): string {
  const fallback = "Application not found";
  if (!message) return fallback;
  const lower = message.toLowerCase();
  if (
    lower.includes("not found") ||
    lower.includes("not authorized") ||
    lower.includes("permission") ||
    lower.includes("belong to the assigned")
  ) {
    if (lower.includes("belong to the assigned")) {
      return "Owner must belong to your franchise.";
    }
    return message.includes("Owner must") ? "Owner must belong to your franchise." : fallback;
  }
  // Strip UUID-looking tokens from unexpected provider errors.
  return message.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "[redacted]",
  );
}
