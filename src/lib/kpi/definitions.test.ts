import { describe, it, expect } from "vitest";
import {
  median,
  pct,
  periodToWindow,
  inWindow,
  dedupeStageHistory,
  computeApplicationsReviewed,
  computeActiveWorkload,
  computeTimeToFirstReview,
  computeCvReviewConversion,
  computeTestingPassRate,
  computeInterviewConversion,
  computeOfferToHire,
  computePlacementRate,
  computeClientSubmissionAcceptance,
  computeWithdrawalRate,
  computeRejectionBreakdown,
  compareHigherIsBetter,
  compareLowerIsBetter,
  awaitingFirstReviewAppIds,
  computeStalledApplications,
  computeStalledByStage,
  computeEmployerResponseTime,
  computeCandidateResponseTime,
  computeWithdrawalReasonBreakdown,
  computeInterviewRescheduleCounts,
  computeUnansweredStaffNotifications,
  computeOverdueCandidateUpdates,
  computeMissingScreeningNotes,
  type ConsentResponseSnapshot,
  type InterviewScheduleChange,
  type InterviewSnapshot,
  type StaffNotificationSnapshot,
  type StageHistoryEvent,
  type ApplicationSnapshot,
  type AssessmentSnapshot,
  type OfferSnapshot,
  type PlacementSnapshot,
  type SubmissionSnapshot,
} from "@/lib/kpi/definitions";

const window = periodToWindow("30d", new Date("2026-07-27T12:00:00.000Z"));

function hist(
  partial: Partial<StageHistoryEvent> & Pick<StageHistoryEvent, "applicationId" | "toStage">,
): StageHistoryEvent {
  return {
    fromStage: partial.fromStage ?? "cv_review",
    actorId: partial.actorId ?? "rec-1",
    createdAt: partial.createdAt ?? "2026-07-10T10:00:00.000Z",
    reason: null,
    ...partial,
  };
}

function app(
  partial: Partial<ApplicationSnapshot> & Pick<ApplicationSnapshot, "id">,
): ApplicationSnapshot {
  return {
    assignedRecruiterId: "rec-1",
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

describe("median", () => {
  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });
  it("handles odd sample sizes", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("handles even sample sizes", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("pct / insufficient data", () => {
  it("returns null when denominator is 0 (never 0%)", () => {
    expect(pct(0, 0)).toBeNull();
    expect(compareHigherIsBetter(null, 50, 0)).toBe("insufficient_data");
    expect(compareLowerIsBetter(null, 10, 0)).toBe("insufficient_data");
  });
});

describe("date window", () => {
  it("is inclusive of since and exclusive of until", () => {
    expect(inWindow(window.since, window)).toBe(true);
    expect(inWindow(window.until, window)).toBe(false);
    expect(inWindow("2026-07-01T00:00:00.000Z", window)).toBe(true);
  });
});

describe("dedupeStageHistory", () => {
  it("does not double-count consecutive identical to_stage", () => {
    const events = [
      hist({ applicationId: "a1", toStage: "testing", createdAt: "2026-07-10T10:00:00.000Z" }),
      hist({ applicationId: "a1", toStage: "testing", createdAt: "2026-07-10T11:00:00.000Z" }),
      hist({
        applicationId: "a1",
        toStage: "interview_review",
        createdAt: "2026-07-11T10:00:00.000Z",
      }),
    ];
    expect(dedupeStageHistory(events)).toHaveLength(2);
  });
});

describe("applications reviewed", () => {
  it("counts distinct apps with meaningful actions by recruiter", () => {
    const history = [
      hist({
        applicationId: "a1",
        fromStage: "cv_review",
        toStage: "testing",
        actorId: "rec-1",
        createdAt: "2026-07-10T10:00:00.000Z",
      }),
      hist({
        applicationId: "a1",
        fromStage: "testing",
        toStage: "test_review",
        actorId: "rec-1",
        createdAt: "2026-07-11T10:00:00.000Z",
      }),
      hist({
        applicationId: "a2",
        toStage: "rejected",
        actorId: "rec-1",
        createdAt: "2026-07-12T10:00:00.000Z",
      }),
      hist({
        applicationId: "a3",
        toStage: "testing",
        actorId: "rec-other",
        createdAt: "2026-07-12T10:00:00.000Z",
      }),
    ];
    const m = computeApplicationsReviewed(history, window, "rec-1");
    expect(m.numerator).toBe(2);
    expect(m.value).toBe(2);
  });
});

describe("active workload", () => {
  it("excludes terminal, withdrawn, and closed jobs", () => {
    const apps = [
      app({ id: "a1", currentStage: "testing" }),
      app({ id: "a2", currentStage: "hired" }),
      app({ id: "a3", currentStage: "testing", withdrawnAt: "2026-07-05T00:00:00.000Z" }),
      app({ id: "a4", currentStage: "cv_review", jobOrderId: "closed-job" }),
      app({ id: "a5", assignedRecruiterId: "other", currentStage: "testing" }),
    ];
    const w = computeActiveWorkload(apps, "rec-1", new Set(["closed-job"]));
    expect(w.total).toBe(1);
    expect(w.byStage.testing).toBe(1);
  });
});

describe("time to first review", () => {
  it("excludes never-reviewed from median but counts awaiting", () => {
    const apps = [
      app({ id: "a1", createdAt: "2026-07-01T00:00:00.000Z" }),
      app({ id: "a2", createdAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const history = [
      hist({
        applicationId: "a1",
        toStage: "testing",
        createdAt: "2026-07-02T00:00:00.000Z",
      }),
    ];
    const m = computeTimeToFirstReview(apps, history, window, "rec-1", 48);
    expect(m.sampleSize).toBe(1);
    expect(m.value).toBe(24);
    expect(m.awaitingFirstReview).toBe(1);
  });
});

describe("CV review conversion", () => {
  it("uses correct numerator and denominator", () => {
    const history = [
      hist({
        applicationId: "a1",
        fromStage: "cv_review",
        toStage: "testing",
        createdAt: "2026-07-10T10:00:00.000Z",
      }),
      hist({
        applicationId: "a1",
        fromStage: "testing",
        toStage: "interview_review",
        createdAt: "2026-07-11T10:00:00.000Z",
      }),
      hist({
        applicationId: "a2",
        fromStage: "cv_review",
        toStage: "rejected",
        createdAt: "2026-07-10T12:00:00.000Z",
      }),
    ];
    const m = computeCvReviewConversion(history, window, "rec-1");
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
    expect(m.value).toBe(50);
  });
});

describe("testing pass rate", () => {
  it("excludes human-review-pending assessments", () => {
    const assessments: AssessmentSnapshot[] = [
      {
        id: "1",
        applicationId: "a1",
        status: "graded",
        score: 80,
        passThreshold: 65,
        humanReviewRequired: false,
        gradedAt: "2026-07-15T00:00:00.000Z",
        dueAt: null,
        graderId: "rec-1",
      },
      {
        id: "2",
        applicationId: "a2",
        status: "graded",
        score: 90,
        passThreshold: 65,
        humanReviewRequired: true,
        gradedAt: "2026-07-15T00:00:00.000Z",
        dueAt: null,
        graderId: null,
      },
      {
        id: "3",
        applicationId: "a3",
        status: "graded",
        score: 50,
        passThreshold: 65,
        humanReviewRequired: false,
        gradedAt: "2026-07-15T00:00:00.000Z",
        dueAt: null,
        graderId: "rec-1",
      },
    ];
    const m = computeTestingPassRate(assessments, window);
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
    expect(m.value).toBe(50);
  });
});

describe("interview conversion", () => {
  it("counts later CS/offer/hired", () => {
    const history = [
      hist({
        applicationId: "a1",
        toStage: "interview_review",
        createdAt: "2026-07-10T00:00:00.000Z",
      }),
      hist({
        applicationId: "a1",
        toStage: "client_submission",
        createdAt: "2026-07-12T00:00:00.000Z",
      }),
      hist({
        applicationId: "a2",
        toStage: "interview_review",
        createdAt: "2026-07-10T00:00:00.000Z",
      }),
    ];
    const m = computeInterviewConversion(history, window, "rec-1", 40);
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
    expect(m.value).toBe(50);
  });
});

describe("offer-to-hire", () => {
  it("does not count hire without accepted offer + placement", () => {
    const offers: OfferSnapshot[] = [
      {
        id: "o1",
        applicationId: "a1",
        status: "accepted",
        updatedAt: "2026-07-20T00:00:00.000Z",
        createdAt: "2026-07-18T00:00:00.000Z",
        expiresAt: null,
        owningOrgId: "org-1",
      },
      {
        id: "o2",
        applicationId: "a2",
        status: "declined",
        updatedAt: "2026-07-20T00:00:00.000Z",
        createdAt: "2026-07-18T00:00:00.000Z",
        expiresAt: null,
        owningOrgId: "org-1",
      },
    ];
    const placements: PlacementSnapshot[] = [
      {
        id: "p1",
        applicationId: "a1",
        offerId: "o1",
        recruiterId: "rec-1",
        status: "active",
        fee: 1000,
        createdAt: "2026-07-21T00:00:00.000Z",
        owningOrgId: "org-1",
      },
    ];
    const m = computeOfferToHire(offers, placements, window, 50);
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
    expect(m.value).toBe(50);
  });

  it("returns unavailable when no finalized offers", () => {
    const m = computeOfferToHire([], [], window, 50);
    expect(m.value).toBeNull();
    expect(m.unavailableReason).toBeTruthy();
    expect(m.status).toBe("insufficient_data");
  });
});

describe("placement rate", () => {
  it("uses client submission → valid placement", () => {
    const history = [
      hist({
        applicationId: "a1",
        toStage: "client_submission",
        createdAt: "2026-07-10T00:00:00.000Z",
      }),
      hist({
        applicationId: "a2",
        toStage: "client_submission",
        createdAt: "2026-07-10T00:00:00.000Z",
      }),
    ];
    const placements: PlacementSnapshot[] = [
      {
        id: "p1",
        applicationId: "a1",
        offerId: "o1",
        recruiterId: "rec-1",
        status: "active",
        fee: null,
        createdAt: "2026-07-20T00:00:00.000Z",
        owningOrgId: "org-1",
      },
    ];
    const m = computePlacementRate(history, placements, window, 70, "rec-1");
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
    expect(m.value).toBe(50);
  });
});

describe("client submission acceptance", () => {
  it("counts accepted statuses only among decided", () => {
    const subs: SubmissionSnapshot[] = [
      {
        id: "s1",
        applicationId: "a1",
        status: "shortlisted",
        submittedAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        submittingOrgId: "org-1",
      },
      {
        id: "s2",
        applicationId: "a2",
        status: "rejected",
        submittedAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        submittingOrgId: "org-1",
      },
      {
        id: "s3",
        applicationId: "a3",
        status: "submitted",
        submittedAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        submittingOrgId: "org-1",
      },
    ];
    const m = computeClientSubmissionAcceptance(subs, window, 40);
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
  });
});

describe("withdrawal / rejection", () => {
  it("handles withdrawals correctly", () => {
    const apps = [app({ id: "a1" }), app({ id: "a2", withdrawnAt: "2026-07-15T00:00:00.000Z" })];
    const m = computeWithdrawalRate(apps, window, "rec-1");
    expect(m.numerator).toBe(1);
    expect(m.denominator).toBe(2);
    expect(m.value).toBe(50);
  });

  it("groups rejection reasons and other text", () => {
    const apps = [
      app({
        id: "a1",
        rejectedAt: "2026-07-15T00:00:00.000Z",
        rejectedFromStage: "cv_review",
        rejectionReason: "Missing required skill",
      }),
      app({
        id: "a2",
        rejectedAt: "2026-07-15T00:00:00.000Z",
        rejectedFromStage: "testing",
        rejectionReason: "Custom weird reason",
      }),
    ];
    const r = computeRejectionBreakdown(
      apps,
      window,
      [
        { key: "missing_skill", label: "Missing required skill" },
        { key: "other", label: "Other" },
      ],
      "rec-1",
    );
    expect(r.total).toBe(2);
    expect(r.byReasonKey.missing_skill).toBe(1);
    expect(r.byReasonKey.other).toBe(1);
    expect(r.otherReasons).toContain("Custom weird reason");
  });
});

describe("reassignment attribution", () => {
  it("credits review to actor, not current assignee", () => {
    const history = [
      hist({
        applicationId: "a1",
        actorId: "rec-old",
        toStage: "testing",
        createdAt: "2026-07-10T00:00:00.000Z",
      }),
    ];
    const old = computeApplicationsReviewed(history, window, "rec-old");
    const neu = computeApplicationsReviewed(history, window, "rec-new");
    expect(old.numerator).toBe(1);
    expect(neu.numerator).toBe(0);

    const apps = [app({ id: "a1", assignedRecruiterId: "rec-new", currentStage: "testing" })];
    expect(computeActiveWorkload(apps, "rec-new").total).toBe(1);
    expect(computeActiveWorkload(apps, "rec-old").total).toBe(0);
  });
});

describe("multiple applications per job", () => {
  it("counts apps distinctly for placement rate", () => {
    const history = [
      hist({ applicationId: "a1", toStage: "client_submission" }),
      hist({ applicationId: "a2", toStage: "client_submission" }),
    ];
    const placements: PlacementSnapshot[] = [
      {
        id: "p1",
        applicationId: "a1",
        offerId: null,
        recruiterId: "rec-1",
        status: "active",
        fee: null,
        createdAt: "2026-07-20T00:00:00.000Z",
        owningOrgId: "org-1",
      },
    ];
    const m = computePlacementRate(history, placements, window, 70, "rec-1");
    expect(m.denominator).toBe(2);
    expect(m.numerator).toBe(1);
  });
});

// ---- Workstream A: attention queue + response time + CX guardrail metrics ----

describe("awaiting first review + stalled drill-downs", () => {
  it("returns the exact application ids behind each count", () => {
    const history = [
      hist({ applicationId: "a1", toStage: "testing", createdAt: "2026-07-10T00:00:00.000Z" }),
    ];
    const apps = [
      app({ id: "a1" }),
      app({ id: "a2" }), // assigned, never reviewed
      app({ id: "a3", withdrawnAt: "2026-07-05T00:00:00.000Z" }),
      app({ id: "a4", currentStage: "hired" }),
      app({ id: "a5", assignedRecruiterId: "rec-2" }), // someone else's
    ];

    expect(awaitingFirstReviewAppIds(apps, history, "rec-1")).toEqual(["a2"]);

    const ttfr = computeTimeToFirstReview(apps, history, window, "rec-1", 48);
    expect(ttfr.awaitingAppIds).toEqual(["a2"]);
    expect(ttfr.reviewedAppIds).toEqual(["a1"]);
    expect(ttfr.awaitingFirstReview).toBe(1);
  });

  it("computeStalledApplications exposes ids, thresholds, and a due date", () => {
    const now = "2026-07-27T12:00:00.000Z";
    const apps = [
      app({ id: "s1", currentStage: "cv_review" }),
      app({ id: "s2", currentStage: "cv_review" }),
    ];
    const history = [
      // s1 entered cv_review 100h ago (threshold 72h) → stalled
      hist({
        applicationId: "s1",
        toStage: "cv_review",
        fromStage: null,
        createdAt: "2026-07-23T08:00:00.000Z",
      }),
      // s2 entered 2h ago → fine
      hist({
        applicationId: "s2",
        toStage: "cv_review",
        fromStage: null,
        createdAt: "2026-07-27T10:00:00.000Z",
      }),
    ];

    const stalled = computeStalledApplications(apps, history, { cv_review: 72 }, now, "rec-1");
    expect(stalled.map((s) => s.applicationId)).toEqual(["s1"]);
    expect(stalled[0]!.thresholdHours).toBe(72);
    expect(stalled[0]!.dueAt).toBe("2026-07-26T08:00:00.000Z");

    const byStage = computeStalledByStage(apps, history, { cv_review: 72 }, now, "rec-1");
    expect(byStage.total).toBe(1);
    expect(byStage.appIds).toEqual(["s1"]);
    // The count and the drill-down can never disagree.
    expect(byStage.total).toBe(byStage.appIds.length);
  });
});

describe("employer response time", () => {
  const base = {
    applicationId: "a1",
    updatedAt: "2026-07-12T00:00:00.000Z",
    submittingOrgId: "org-1",
  };

  it("measures submitted_at → responded_at and reports overdue separately", () => {
    const submissions: SubmissionSnapshot[] = [
      {
        ...base,
        id: "s1",
        status: "shortlisted",
        submittedAt: "2026-07-10T00:00:00.000Z",
        respondedAt: "2026-07-12T00:00:00.000Z", // 48h
        responseDueAt: "2026-07-15T00:00:00.000Z",
      },
      {
        ...base,
        id: "s2",
        status: "submitted",
        submittedAt: "2026-07-01T00:00:00.000Z",
        respondedAt: null,
        responseDueAt: "2026-07-06T00:00:00.000Z", // past now → overdue
      },
      {
        ...base,
        id: "s3",
        status: "submitted",
        submittedAt: "2026-07-26T00:00:00.000Z",
        respondedAt: null,
        responseDueAt: "2026-08-01T00:00:00.000Z", // not yet due
      },
    ];

    const r = computeEmployerResponseTime(submissions, window, 120, "2026-07-27T12:00:00.000Z");
    expect(r.medianHours).toBe(48);
    expect(r.sampleSize).toBe(1);
    expect(r.overdue.map((o) => o.id)).toEqual(["s2"]);
    expect(r.awaiting.map((o) => o.id)).toEqual(["s3"]);
    expect(r.status).toBe("on_target");
  });

  it("is unsupported (never 0) when no submission records submitted_at", () => {
    const submissions: SubmissionSnapshot[] = [
      { ...base, id: "s1", status: "shortlisted", submittedAt: null, respondedAt: null },
    ];
    const r = computeEmployerResponseTime(submissions, window, 120, "2026-07-27T12:00:00.000Z");
    expect(r.value).toBeNull();
    expect(r.status).toBe("insufficient_data");
    expect(r.unavailableReason).toContain("submitted_at");
  });

  it("excludes historic decided packs that lack responded_at from awaiting", () => {
    const submissions: SubmissionSnapshot[] = [
      {
        ...base,
        id: "s-old",
        status: "shortlisted",
        submittedAt: "2026-06-01T00:00:00.000Z",
        respondedAt: null, // pre-stamp decision — must not look "still waiting"
        responseDueAt: null,
      },
      {
        ...base,
        id: "s-open",
        status: "submitted",
        submittedAt: "2026-07-26T00:00:00.000Z",
        respondedAt: null,
        responseDueAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const r = computeEmployerResponseTime(submissions, window, 120, "2026-07-27T12:00:00.000Z");
    expect(r.awaiting.map((o) => o.id)).toEqual(["s-open"]);
    expect(r.overdue).toEqual([]);
    expect(r.medianHours).toBeNull();
  });
});

describe("candidate response time", () => {
  it("covers the interview-invitation and consent paths, and stays separate from employer time", () => {
    const interviews: InterviewSnapshot[] = [
      {
        id: "i1",
        applicationId: "a1",
        status: "confirmed",
        scheduledAt: null,
        createdAt: "2026-07-10T00:00:00.000Z",
        candidateResponseDueAt: "2026-07-13T00:00:00.000Z",
        candidateRespondedAt: "2026-07-10T12:00:00.000Z", // 12h
      },
      {
        id: "i2",
        applicationId: "a2",
        status: "requested",
        scheduledAt: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        candidateResponseDueAt: "2026-07-04T00:00:00.000Z", // overdue
        candidateRespondedAt: null,
      },
    ];
    const consents: ConsentResponseSnapshot[] = [
      {
        applicationId: "a3",
        requestedAt: "2026-07-10T00:00:00.000Z",
        respondedAt: "2026-07-11T00:00:00.000Z", // 24h
      },
      // Pre-migration row: no request moment recorded → excluded, not guessed.
      { applicationId: "a4", requestedAt: null, respondedAt: "2026-07-11T00:00:00.000Z" },
    ];

    const r = computeCandidateResponseTime(
      interviews,
      consents,
      window,
      72,
      "2026-07-27T12:00:00.000Z",
    );
    expect(r.hours.sort((a, b) => a - b)).toEqual([12, 24]);
    expect(r.medianHours).toBe(18);
    expect(r.sampleSize).toBe(2);
    expect(r.overdue.map((o) => o.id)).toEqual(["interview:i2"]);
    expect(r.respondedIds).not.toContain("consent:a4");
  });

  it("is unsupported when no request moment was ever recorded", () => {
    const interviews: InterviewSnapshot[] = [
      { id: "i1", applicationId: "a1", status: "requested", scheduledAt: null },
    ];
    const r = computeCandidateResponseTime(interviews, [], window, 72, "2026-07-27T12:00:00.000Z");
    expect(r.value).toBeNull();
    expect(r.unavailableReason).toContain("candidate_response_due_at");
  });
});

describe("CX guardrails", () => {
  it("breaks withdrawals down by reason and flags that capture is unsupported", () => {
    const apps = [
      app({ id: "w1", withdrawnAt: "2026-07-10T00:00:00.000Z" }),
      app({ id: "w2", withdrawnAt: "2026-07-11T00:00:00.000Z" }),
      app({ id: "w3", withdrawnAt: "2026-01-01T00:00:00.000Z" }), // outside window
      app({ id: "w4", withdrawnAt: "2026-07-11T00:00:00.000Z", assignedRecruiterId: "rec-2" }),
    ];
    const noReasons = computeWithdrawalReasonBreakdown(apps, [], window, "rec-1");
    expect(noReasons.total).toBe(2);
    expect(noReasons.unspecified).toBe(2);
    expect(noReasons.appIds).toEqual(["w1", "w2"]);
    expect(noReasons.reasonCaptureSupported).toBe(false);
    expect(noReasons.note).toContain("No withdrawal reason");

    const withReason = computeWithdrawalReasonBreakdown(
      apps,
      [
        hist({
          applicationId: "w1",
          toStage: "withdrawn",
          createdAt: "2026-07-10T00:00:00.000Z",
          reason: "Took another offer",
        }),
      ],
      window,
      "rec-1",
    );
    expect(withReason.byReason).toEqual({ "Took another offer": 1 });
    expect(withReason.unspecified).toBe(1);
    expect(withReason.reasonCaptureSupported).toBe(true);
  });

  it("counts interview reschedules and repeat offenders", () => {
    const changes: InterviewScheduleChange[] = [
      { applicationId: "a1", changeKind: "scheduled", createdAt: "2026-07-05T00:00:00.000Z" },
      { applicationId: "a1", changeKind: "rescheduled", createdAt: "2026-07-06T00:00:00.000Z" },
      { applicationId: "a1", changeKind: "rescheduled", createdAt: "2026-07-07T00:00:00.000Z" },
      { applicationId: "a2", changeKind: "rescheduled", createdAt: "2026-07-08T00:00:00.000Z" },
      { applicationId: "a3", changeKind: "cancelled", createdAt: "2026-07-09T00:00:00.000Z" },
      { applicationId: "a9", changeKind: "rescheduled", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const r = computeInterviewRescheduleCounts(changes, window);
    expect(r.rescheduled).toBe(3);
    expect(r.cancelled).toBe(1);
    expect(r.scheduled).toBe(1);
    expect(r.repeatOffenderAppIds).toEqual(["a1"]);
    expect(r.appIds).not.toContain("a9");
    expect(r.historyStartsAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("counts only unread notifications past the grace window", () => {
    const now = "2026-07-27T12:00:00.000Z";
    const notifications: StaffNotificationSnapshot[] = [
      {
        id: "n1",
        applicationId: "a1",
        category: "stage",
        createdAt: "2026-07-20T00:00:00.000Z",
        readAt: null,
      },
      {
        id: "n2",
        applicationId: "a2",
        category: "stage",
        createdAt: "2026-07-27T06:00:00.000Z",
        readAt: null,
      },
      {
        id: "n3",
        applicationId: "a3",
        category: "stage",
        createdAt: "2026-07-10T00:00:00.000Z",
        readAt: "2026-07-10T01:00:00.000Z",
      },
    ];
    const r = computeUnansweredStaffNotifications(notifications, window, now, 48);
    expect(r.total).toBe(2);
    expect(r.overdue).toBe(1);
    expect(r.appIds).toEqual(["a1"]);
  });

  it("flags candidate silence beyond the threshold and prefers the last update over the stage change", () => {
    const now = "2026-07-27T12:00:00.000Z";
    const apps = [app({ id: "a1" }), app({ id: "a2" }), app({ id: "a3", currentStage: "hired" })];
    const history = [
      hist({ applicationId: "a1", toStage: "testing", createdAt: "2026-07-01T00:00:00.000Z" }),
      hist({ applicationId: "a2", toStage: "testing", createdAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const lastUpdate = new Map([["a2", "2026-07-26T00:00:00.000Z"]]);

    const overdue = computeOverdueCandidateUpdates(apps, history, lastUpdate, now, 168, "rec-1");
    expect(overdue.map((o) => o.applicationId)).toEqual(["a1"]);
    expect(overdue[0]!.lastUpdateAt).toBeNull();
  });

  it("finds cv_review applications blocked by the screening-notes gate", () => {
    const apps = [
      app({ id: "a1", currentStage: "cv_review" }),
      app({ id: "a2", currentStage: "cv_review" }),
      app({ id: "a3", currentStage: "testing" }),
      app({ id: "a4", currentStage: "cv_review", assignedRecruiterId: "rec-2" }),
      app({ id: "a5", currentStage: "cv_review", withdrawnAt: "2026-07-01T00:00:00.000Z" }),
    ];
    expect(computeMissingScreeningNotes(apps, new Set(["a2"]), "rec-1")).toEqual(["a1"]);
  });
});
