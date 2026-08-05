import { describe, it, expect } from "vitest";
import {
  ATTENTION_KINDS,
  NEXT_ACTION_BY_KIND,
  buildAttentionQueue,
  nextActionForKind,
  openAssignedAppIds,
  resolveOwner,
  restrictToScope,
  scopedApplicationIds,
  type AttentionInput,
} from "@/lib/kpi/attention";
import type {
  ApplicationSnapshot,
  AssessmentSnapshot,
  InterviewSnapshot,
  OfferSnapshot,
  StageHistoryEvent,
  SubmissionSnapshot,
} from "@/lib/kpi/definitions";

const NOW = "2026-07-27T12:00:00.000Z";
const ME = "rec-1";
const OTHER = "rec-2";

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

function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    recruiterId: ME,
    nowIso: NOW,
    apps: [],
    history: [],
    assessments: [],
    interviews: [],
    offers: [],
    submissions: [],
    appIdsWithScreeningNotes: new Set(),
    stageThresholds: { cv_review: 72 },
    firstReviewTargetHours: 48,
    jobOwnerByJobOrder: new Map(),
    lastCandidateUpdateByApp: new Map(),
    maxCandidateSilenceHours: 168,
    hiredAppIdsAwaitingPlacement: new Set(),
    ...overrides,
  };
}

describe("next action mapping", () => {
  it("maps every SLA kind to exactly one next action", () => {
    for (const kind of ATTENTION_KINDS) {
      expect(nextActionForKind(kind)).toBe(NEXT_ACTION_BY_KIND[kind]);
      expect(NEXT_ACTION_BY_KIND[kind]).toBeTruthy();
    }
    expect(Object.keys(NEXT_ACTION_BY_KIND).sort()).toEqual([...ATTENTION_KINDS].sort());
  });
});

describe("ownership resolution", () => {
  it("prefers the assigned recruiter, then the job owner, then the viewer", () => {
    expect(resolveOwner(app({ id: "a1" }), new Map(), ME)).toEqual({
      ownerUserId: ME,
      ownerSource: "assigned_recruiter",
    });
    expect(
      resolveOwner(
        app({ id: "a2", assignedRecruiterId: null }),
        new Map([["job-1", "owner-9"]]),
        ME,
      ),
    ).toEqual({ ownerUserId: "owner-9", ownerSource: "job_owner" });
    expect(resolveOwner(app({ id: "a3", assignedRecruiterId: null }), new Map(), ME)).toEqual({
      ownerUserId: ME,
      ownerSource: "viewer",
    });
  });
});

describe("buildAttentionQueue", () => {
  const apps = [
    // Applied 26 days ago, never reviewed → overdue first review + stalled
    app({ id: "a1" }),
    app({ id: "a2", currentStage: "testing" }),
    app({ id: "a3", currentStage: "interview_screening" }),
    app({ id: "a4", currentStage: "client_submission" }),
    app({ id: "a5", currentStage: "offer" }),
    app({ id: "a6", currentStage: "hired" }),
  ];
  const history: StageHistoryEvent[] = [
    {
      applicationId: "a2",
      fromStage: "cv_review",
      toStage: "testing",
      actorId: ME,
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    {
      applicationId: "a3",
      fromStage: "cv_review",
      toStage: "interview_screening",
      actorId: ME,
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    {
      applicationId: "a4",
      fromStage: "cv_review",
      toStage: "client_submission",
      actorId: ME,
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    {
      applicationId: "a5",
      fromStage: "cv_review",
      toStage: "offer",
      actorId: ME,
      createdAt: "2026-07-02T00:00:00.000Z",
    },
    {
      applicationId: "a6",
      fromStage: "cv_review",
      toStage: "hired",
      actorId: ME,
      createdAt: "2026-07-02T00:00:00.000Z",
    },
  ];
  const assessments: AssessmentSnapshot[] = [
    {
      id: "as1",
      applicationId: "a2",
      status: "assigned",
      score: null,
      passThreshold: null,
      humanReviewRequired: false,
      gradedAt: null,
      dueAt: "2026-07-20T00:00:00.000Z",
      graderId: null,
    },
  ];
  const interviews: InterviewSnapshot[] = [
    {
      id: "iv1",
      applicationId: "a3",
      status: "scheduled",
      scheduledAt: "2026-07-25T00:00:00.000Z",
    },
  ];
  const submissions: SubmissionSnapshot[] = [
    {
      id: "sub1",
      applicationId: "a4",
      status: "submitted",
      submittedAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      submittingOrgId: "org-1",
      responseDueAt: "2026-07-25T00:00:00.000Z",
    },
  ];
  const offers: OfferSnapshot[] = [
    {
      id: "of1",
      applicationId: "a5",
      status: "sent",
      updatedAt: "2026-07-20T00:00:00.000Z",
      createdAt: "2026-07-20T00:00:00.000Z",
      expiresAt: "2026-08-05T00:00:00.000Z",
      owningOrgId: "org-1",
    },
  ];

  const queue = buildAttentionQueue(
    input({
      apps,
      history,
      assessments,
      interviews,
      submissions,
      offers,
      hiredAppIdsAwaitingPlacement: new Set(["a6"]),
      stageThresholds: { cv_review: 72, testing: 72 },
    }),
  );

  it("every flagged SLA item carries ownerUserId, nextAction, dueAt intent, and applicationId", () => {
    expect(queue.items.length).toBeGreaterThan(0);
    for (const item of queue.items) {
      expect(item.ownerUserId).toBeTruthy();
      expect(item.nextAction).toBe(NEXT_ACTION_BY_KIND[item.kind]);
      expect(item.applicationId).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(item, "dueAt")).toBe(true);
    }
  });

  it("covers all six attention-first categories", () => {
    expect(queue.countsByKind.overdue_first_review).toBe(1); // a1
    expect(queue.countsByKind.assessment_past_due).toBe(1); // as1
    expect(queue.countsByKind.interview_overdue).toBe(1); // iv1
    expect(queue.countsByKind.employer_approval_awaiting).toBe(1); // sub1
    expect(queue.countsByKind.stalled_in_stage).toBeGreaterThan(0);
    expect(queue.countsByKind.missing_screening_notes).toBe(1); // a1 in cv_review
    expect(queue.countsByKind.offer_awaiting_response).toBe(1);
    expect(queue.countsByKind.hire_awaiting_placement).toBe(1);
  });

  it("sorts most-overdue first", () => {
    const overdue = queue.items.filter((i) => i.overdueHours != null);
    const hours = overdue.map((i) => i.overdueHours as number);
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    expect(queue.totalOverdue).toBe(overdue.length);
  });

  it("counts and drill-down ids agree for every kind", () => {
    for (const kind of ATTENTION_KINDS) {
      const ids = new Set(queue.items.filter((i) => i.kind === kind).map((i) => i.applicationId));
      expect(queue.appIdsByKind[kind].sort()).toEqual([...ids].sort());
    }
  });

  it("never emits an item for an application outside the loaded scope", () => {
    const q = buildAttentionQueue(
      input({
        apps: [app({ id: "a1" })],
        // Assessment references an application that was filtered out of scope.
        assessments: [
          {
            id: "ghost",
            applicationId: "not-mine",
            status: "assigned",
            score: null,
            passThreshold: null,
            humanReviewRequired: false,
            gradedAt: null,
            dueAt: "2026-01-01T00:00:00.000Z",
            graderId: null,
          },
        ],
      }),
    );
    expect(q.items.every((i) => i.applicationId === "a1")).toBe(true);
  });
});

describe("scope enforcement", () => {
  it("scopedApplicationIds covers assigned apps plus ones the recruiter acted on", () => {
    const apps = [
      app({ id: "mine" }),
      app({ id: "reassigned", assignedRecruiterId: OTHER }),
      app({ id: "theirs", assignedRecruiterId: OTHER }),
    ];
    const history: StageHistoryEvent[] = [
      {
        applicationId: "reassigned",
        fromStage: "cv_review",
        toStage: "testing",
        actorId: ME,
        createdAt: NOW,
      },
      {
        applicationId: "theirs",
        fromStage: "cv_review",
        toStage: "testing",
        actorId: OTHER,
        createdAt: NOW,
      },
    ];
    const ids = scopedApplicationIds(apps, history, ME);
    expect([...ids].sort()).toEqual(["mine", "reassigned"]);
    expect(ids.has("theirs")).toBe(false);
  });

  it("restrictToScope drops out-of-scope items and recomputes every count", () => {
    const q = buildAttentionQueue(
      input({
        apps: [app({ id: "a1" }), app({ id: "a2", assignedRecruiterId: OTHER })],
        // a2 belongs to another recruiter; simulate it leaking into the queue.
        assessments: [
          {
            id: "as1",
            applicationId: "a2",
            status: "assigned",
            score: null,
            passThreshold: null,
            humanReviewRequired: false,
            gradedAt: null,
            dueAt: "2026-07-01T00:00:00.000Z",
            graderId: null,
          },
        ],
      }),
    );
    expect(q.items.some((i) => i.applicationId === "a2")).toBe(true);

    const restricted = restrictToScope(q, new Set(["a1"]));
    expect(restricted.items.every((i) => i.applicationId === "a1")).toBe(true);
    expect(restricted.countsByKind.assessment_past_due).toBe(0);
    expect(restricted.appIdsByKind.assessment_past_due).toEqual([]);
    expect(restricted.totalOverdue).toBe(
      restricted.items.filter((i) => i.overdueHours != null).length,
    );
  });

  it("openAssignedAppIds excludes terminal and withdrawn work", () => {
    const apps = [
      app({ id: "a1" }),
      app({ id: "a2", currentStage: "hired" }),
      app({ id: "a3", withdrawnAt: NOW }),
      app({ id: "a4", assignedRecruiterId: OTHER }),
    ];
    expect(openAssignedAppIds(apps, ME)).toEqual(["a1"]);
  });
});
