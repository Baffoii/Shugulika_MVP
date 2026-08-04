/**
 * Drill-down id extraction — pure, no I/O.
 *
 * Every KPI card and SLA count on the recruiter dashboard must be able to open
 * the exact applications behind the number. The metric functions in
 * definitions.ts return counts; these extractors return the matching
 * application ids using the *same* predicates, so a card and its drill-down can
 * never disagree.
 */
import {
  ACCEPTED_SUBMISSION_STATUSES,
  CV_REVIEW_COMPLETED_TO,
  FINALIZED_OFFER_STATUSES,
  POST_CV_STAGES,
  POST_INTERVIEW_STAGES,
  VALID_PLACEMENT_STATUSES,
  dedupeStageHistory,
  inWindow,
  isMeaningfulReviewEvent,
  type ApplicationSnapshot,
  type AssessmentSnapshot,
  type DateWindow,
  type OfferSnapshot,
  type PlacementSnapshot,
  type StageHistoryEvent,
  type SubmissionSnapshot,
} from "./definitions";

/** Canonical drill-down keys. One per KPI card / SLA count on the page. */
export const DRILLDOWN_KEYS = [
  "applications_reviewed",
  "active_workload",
  "time_to_first_review",
  "awaiting_first_review",
  "time_to_client_submission",
  "time_to_fill",
  "cv_review_conversion",
  "cv_review_conversion_advanced",
  "testing_pass_rate",
  "testing_pass_rate_passed",
  "interview_conversion",
  "interview_conversion_converted",
  "client_submission_acceptance",
  "client_submission_acceptance_accepted",
  "offer_to_hire",
  "placement_rate",
  "placement_rate_placed",
  "withdrawals",
  "rejections",
] as const;

export type DrilldownKey = (typeof DRILLDOWN_KEYS)[number];

export const DRILLDOWN_LABELS: Record<DrilldownKey, string> = {
  applications_reviewed: "Applications you reviewed",
  active_workload: "Your active workload",
  time_to_first_review: "Applications counted in the median",
  awaiting_first_review: "Awaiting your first review",
  time_to_client_submission: "Reached client submission",
  time_to_fill: "Placements counted",
  cv_review_conversion: "CV reviews completed (denominator)",
  cv_review_conversion_advanced: "Advanced past CV review (numerator)",
  testing_pass_rate: "Graded assessments (denominator)",
  testing_pass_rate_passed: "Passed the threshold (numerator)",
  interview_conversion: "Interview reviews completed (denominator)",
  interview_conversion_converted: "Converted after interview (numerator)",
  client_submission_acceptance: "Employer decisions (denominator)",
  client_submission_acceptance_accepted: "Accepted by the employer (numerator)",
  offer_to_hire: "Finalized offers",
  placement_rate: "Reached client submission (denominator)",
  placement_rate_placed: "Placed (numerator)",
  withdrawals: "Candidate withdrawals",
  rejections: "Rejected applications",
};

export interface DrilldownInput {
  recruiterId: string;
  window: DateWindow;
  apps: ApplicationSnapshot[];
  history: StageHistoryEvent[];
  assessments: AssessmentSnapshot[];
  submissions: SubmissionSnapshot[];
  offers: OfferSnapshot[];
  placements: PlacementSnapshot[];
  workloadAppIds: string[];
  reviewedInWindowAppIds: string[];
  awaitingFirstReviewAppIds: string[];
}

function uniq(ids: Iterable<string>): string[] {
  return [...new Set(ids)];
}

/**
 * Build every drill-down set. Returns application ids only — never candidate
 * names, notes, or employer comments.
 */
export function buildDrilldowns(input: DrilldownInput): Record<DrilldownKey, string[]> {
  const { recruiterId, window, apps, history } = input;
  const sorted = dedupeStageHistory(history).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const appIds = new Set(apps.map((a) => a.id));

  const reviewed = uniq(
    history
      .filter(
        (e) =>
          e.actorId === recruiterId && inWindow(e.createdAt, window) && isMeaningfulReviewEvent(e),
      )
      .map((e) => e.applicationId),
  );

  const reachedCs = uniq(
    sorted
      .filter(
        (e) =>
          e.toStage === "client_submission" &&
          inWindow(e.createdAt, window) &&
          e.actorId === recruiterId,
      )
      .map((e) => e.applicationId),
  );

  const cvReviewed = uniq(
    sorted
      .filter(
        (e) =>
          e.actorId === recruiterId &&
          e.fromStage === "cv_review" &&
          CV_REVIEW_COMPLETED_TO.has(e.toStage) &&
          inWindow(e.createdAt, window),
      )
      .map((e) => e.applicationId),
  );
  const cvAdvanced = cvReviewed.filter((id) =>
    sorted.some(
      (e) => e.applicationId === id && POST_CV_STAGES.has(e.toStage) && e.toStage !== "rejected",
    ),
  );

  const gradedAssessments = input.assessments.filter(
    (a) =>
      a.status === "graded" &&
      !a.humanReviewRequired &&
      a.score != null &&
      a.passThreshold != null &&
      a.gradedAt != null &&
      inWindow(a.gradedAt, window),
  );
  const gradedIds = uniq(gradedAssessments.map((a) => a.applicationId));
  const passedIds = uniq(
    gradedAssessments
      .filter((a) => (a.score as number) >= (a.passThreshold as number))
      .map((a) => a.applicationId),
  );

  const interviewCompleted = uniq(
    sorted
      .filter(
        (e) =>
          e.actorId === recruiterId &&
          e.toStage === "interview_review" &&
          inWindow(e.createdAt, window),
      )
      .map((e) => e.applicationId),
  );
  const interviewConverted = interviewCompleted.filter((id) =>
    sorted.some((e) => e.applicationId === id && POST_INTERVIEW_STAGES.has(e.toStage)),
  );

  const decidedSubmissions = input.submissions.filter(
    (s) =>
      !["consent_pending", "submitted", "viewed"].includes(s.status) &&
      inWindow(s.updatedAt, window),
  );
  const decidedIds = uniq(
    decidedSubmissions.map((s) => s.applicationId).filter(Boolean) as string[],
  );
  const acceptedIds = uniq(
    decidedSubmissions
      .filter((s) => ACCEPTED_SUBMISSION_STATUSES.has(s.status))
      .map((s) => s.applicationId)
      .filter(Boolean) as string[],
  );

  const finalizedOffers = uniq(
    input.offers
      .filter((o) => FINALIZED_OFFER_STATUSES.has(o.status) && inWindow(o.updatedAt, window))
      .map((o) => o.applicationId),
  );

  const validPlacements = input.placements.filter(
    (p) => VALID_PLACEMENT_STATUSES.has(p.status) && inWindow(p.createdAt, window),
  );
  const placedFromCs = reachedCs.filter((id) =>
    validPlacements.some((p) => p.applicationId === id),
  );

  const withdrawals = apps
    .filter((a) => a.assignedRecruiterId === recruiterId)
    .filter((a) => a.withdrawnAt && inWindow(a.withdrawnAt, window))
    .map((a) => a.id);

  const rejections = apps
    .filter((a) => a.assignedRecruiterId === recruiterId)
    .filter((a) => a.rejectedAt && inWindow(a.rejectedAt, window))
    .map((a) => a.id);

  const out: Record<DrilldownKey, string[]> = {
    applications_reviewed: reviewed,
    active_workload: uniq(input.workloadAppIds),
    time_to_first_review: uniq(input.reviewedInWindowAppIds),
    awaiting_first_review: uniq(input.awaitingFirstReviewAppIds),
    time_to_client_submission: reachedCs,
    time_to_fill: uniq(validPlacements.map((p) => p.applicationId)),
    cv_review_conversion: cvReviewed,
    cv_review_conversion_advanced: cvAdvanced,
    testing_pass_rate: gradedIds,
    testing_pass_rate_passed: passedIds,
    interview_conversion: interviewCompleted,
    interview_conversion_converted: interviewConverted,
    client_submission_acceptance: decidedIds,
    client_submission_acceptance_accepted: acceptedIds,
    offer_to_hire: finalizedOffers,
    placement_rate: reachedCs,
    placement_rate_placed: placedFromCs,
    withdrawals,
    rejections,
  };

  // Fail closed: a drill-down may never name an application outside the loaded,
  // already-scoped set.
  for (const key of DRILLDOWN_KEYS) {
    out[key] = out[key].filter((id) => appIds.has(id));
  }
  return out;
}

/**
 * Restrict a drill-down map to ids the viewer is allowed to open. Anything
 * outside the allowed set is dropped silently rather than reported, so an
 * out-of-scope id is never confirmed to exist.
 */
export function restrictDrilldowns(
  drilldowns: Record<string, string[]>,
  allowedApplicationIds: Set<string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(drilldowns)) {
    out[key] = ids.filter((id) => allowedApplicationIds.has(id));
  }
  return out;
}
