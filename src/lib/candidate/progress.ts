import type { CandidateAssessmentListItem } from "@/lib/candidate/types";

export interface CandidateDeadline {
  kind: "application" | "assessment" | "interview";
  label: string;
  at: string;
  href: string;
}

export function nextCandidateDeadline(
  deadlines: CandidateDeadline[],
  now = new Date(),
): CandidateDeadline | null {
  return (
    deadlines
      .filter(
        (item) => Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) >= now.getTime(),
      )
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null
  );
}

export function pendingAssessments(
  assignments: CandidateAssessmentListItem[],
): CandidateAssessmentListItem[] {
  return assignments.filter((item) => ["assigned", "opened", "in_progress"].includes(item.status));
}
