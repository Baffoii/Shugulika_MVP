import { describe, it, expect } from "vitest";
import {
  DRILLDOWN_KEYS,
  DRILLDOWN_LABELS,
  buildDrilldowns,
  restrictDrilldowns,
  type DrilldownInput,
} from "@/lib/kpi/drilldowns";
import {
  computeApplicationsReviewed,
  computeCvReviewConversion,
  computeTestingPassRate,
  periodToWindow,
  type ApplicationSnapshot,
  type AssessmentSnapshot,
  type OfferSnapshot,
  type PlacementSnapshot,
  type StageHistoryEvent,
  type SubmissionSnapshot,
} from "@/lib/kpi/definitions";

const window = periodToWindow("30d", new Date("2026-07-27T12:00:00.000Z"));
const ME = "rec-1";

function app(
  partial: Partial<ApplicationSnapshot> & Pick<ApplicationSnapshot, "id">,
): ApplicationSnapshot {
  return {
    assignedRecruiterId: ME,
    currentStage: "cv_review",
    createdAt: "2026-07-01T00:00:00.000Z",
    withdrawnAt: null,
    rejectedAt: null,
    rejectedFromStage: null,
    rejectionReason: null,
    jobOrderId: "job-1",
    owningOrgId: "org-1",
    ...partial,
  };
}

const apps = [
  app({ id: "a1", currentStage: "testing" }),
  app({ id: "a2", currentStage: "client_submission" }),
  app({ id: "a3", withdrawnAt: "2026-07-12T00:00:00.000Z" }),
  app({ id: "a4", rejectedAt: "2026-07-13T00:00:00.000Z", currentStage: "rejected" }),
];

const history: StageHistoryEvent[] = [
  {
    applicationId: "a1",
    fromStage: "cv_review",
    toStage: "testing",
    actorId: ME,
    createdAt: "2026-07-10T00:00:00.000Z",
  },
  {
    applicationId: "a2",
    fromStage: "cv_review",
    toStage: "testing",
    actorId: ME,
    createdAt: "2026-07-10T00:00:00.000Z",
  },
  {
    applicationId: "a2",
    fromStage: "testing",
    toStage: "client_submission",
    actorId: ME,
    createdAt: "2026-07-14T00:00:00.000Z",
  },
];

const assessments: AssessmentSnapshot[] = [
  {
    id: "as1",
    applicationId: "a1",
    status: "graded",
    score: 80,
    passThreshold: 60,
    humanReviewRequired: false,
    gradedAt: "2026-07-15T00:00:00.000Z",
    dueAt: null,
    graderId: ME,
  },
  {
    id: "as2",
    applicationId: "a2",
    status: "graded",
    score: 40,
    passThreshold: 60,
    humanReviewRequired: false,
    gradedAt: "2026-07-15T00:00:00.000Z",
    dueAt: null,
    graderId: ME,
  },
];

const submissions: SubmissionSnapshot[] = [
  {
    id: "s1",
    applicationId: "a2",
    status: "shortlisted",
    submittedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    submittingOrgId: "org-1",
  },
];

const offers: OfferSnapshot[] = [
  {
    id: "o1",
    applicationId: "a2",
    status: "accepted",
    updatedAt: "2026-07-18T00:00:00.000Z",
    createdAt: "2026-07-17T00:00:00.000Z",
    expiresAt: null,
    owningOrgId: "org-1",
  },
];

const placements: PlacementSnapshot[] = [
  {
    id: "p1",
    applicationId: "a2",
    offerId: "o1",
    recruiterId: ME,
    status: "active",
    fee: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    owningOrgId: "org-1",
  },
];

function input(overrides: Partial<DrilldownInput> = {}): DrilldownInput {
  return {
    recruiterId: ME,
    window,
    apps,
    history,
    assessments,
    submissions,
    offers,
    placements,
    workloadAppIds: ["a1", "a2"],
    reviewedInWindowAppIds: ["a1", "a2"],
    awaitingFirstReviewAppIds: [],
    ...overrides,
  };
}

describe("buildDrilldowns", () => {
  const dd = buildDrilldowns(input());

  it("produces a set for every declared key", () => {
    for (const key of DRILLDOWN_KEYS) {
      expect(dd[key]).toBeInstanceOf(Array);
      expect(DRILLDOWN_LABELS[key]).toBeTruthy();
    }
  });

  it("agrees with the metric counts it mirrors", () => {
    expect(dd.applications_reviewed.length).toBe(
      computeApplicationsReviewed(history, window, ME).numerator,
    );
    expect(dd.cv_review_conversion.length).toBe(
      computeCvReviewConversion(history, window, ME).denominator,
    );
    expect(dd.cv_review_conversion_advanced.length).toBe(
      computeCvReviewConversion(history, window, ME).numerator,
    );
    expect(dd.testing_pass_rate.length).toBe(
      computeTestingPassRate(assessments, window).denominator,
    );
    expect(dd.testing_pass_rate_passed.length).toBe(
      computeTestingPassRate(assessments, window).numerator,
    );
  });

  it("separates numerator from denominator sets", () => {
    expect(dd.testing_pass_rate.sort()).toEqual(["a1", "a2"]);
    expect(dd.testing_pass_rate_passed).toEqual(["a1"]);
    expect(dd.placement_rate).toEqual(["a2"]);
    expect(dd.placement_rate_placed).toEqual(["a2"]);
    expect(dd.withdrawals).toEqual(["a3"]);
    expect(dd.rejections).toEqual(["a4"]);
  });

  it("never returns an application outside the loaded scope", () => {
    const withGhost = buildDrilldowns(
      input({
        // Placement points at an application that is not in `apps`.
        placements: [{ ...placements[0]!, id: "p2", applicationId: "ghost" }],
        workloadAppIds: ["a1", "ghost"],
      }),
    );
    const all = Object.values(withGhost).flat();
    expect(all).not.toContain("ghost");
  });
});

describe("restrictDrilldowns", () => {
  it("filters every set to the allowed ids", () => {
    const restricted = restrictDrilldowns(
      { applications_reviewed: ["a1", "a2"], withdrawals: ["a3"] },
      new Set(["a1"]),
    );
    expect(restricted.applications_reviewed).toEqual(["a1"]);
    expect(restricted.withdrawals).toEqual([]);
  });

  it("returns nothing at all for an empty scope", () => {
    const restricted = restrictDrilldowns({ applications_reviewed: ["a1"] }, new Set());
    expect(Object.values(restricted).flat()).toEqual([]);
  });
});
