/**
 * Attention-first daily queue — pure, no I/O.
 *
 * Every item answers three questions the old count-only SLA panel could not:
 *   * WHO owns it (`ownerUserId`, never null)
 *   * WHAT to do next (`nextAction`, derived from the SLA kind)
 *   * WHEN it was/is due (`dueAt`) and which application (`applicationId`)
 *
 * Ownership resolves assigned recruiter → job owner → the viewing recruiter.
 * The queue is always built from a single recruiter's already-scoped rows, so
 * the final fallback cannot surface another recruiter's work.
 */
import {
  TERMINAL_STAGES,
  computeStalledApplications,
  computeMissingScreeningNotes,
  computeEmployerApprovalsAwaiting,
  computeOverdueCandidateUpdates,
  awaitingFirstReviewAppIds,
  hoursBetween,
  round1,
  type ApplicationSnapshot,
  type AssessmentSnapshot,
  type InterviewSnapshot,
  type OfferSnapshot,
  type StageHistoryEvent,
  type SubmissionSnapshot,
} from "./definitions";

export const ATTENTION_KINDS = [
  "overdue_first_review",
  "assessment_past_due",
  "interview_overdue",
  "employer_approval_awaiting",
  "stalled_in_stage",
  "missing_screening_notes",
  "offer_awaiting_response",
  "hire_awaiting_placement",
  "candidate_update_overdue",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** The six categories that drive the attention-first view and dashboard strip. */
export const PRIMARY_ATTENTION_KINDS: AttentionKind[] = [
  "overdue_first_review",
  "assessment_past_due",
  "interview_overdue",
  "employer_approval_awaiting",
  "stalled_in_stage",
  "missing_screening_notes",
];

export const NEXT_ACTIONS = [
  "review_cv",
  "add_screening_note",
  "chase_assessment",
  "close_out_interview",
  "chase_employer",
  "advance_or_reject",
  "chase_offer_response",
  "record_placement",
  "update_candidate",
] as const;

export type NextAction = (typeof NEXT_ACTIONS)[number];

/** SLA kind → the single next action. One kind never maps to two actions. */
export const NEXT_ACTION_BY_KIND: Record<AttentionKind, NextAction> = {
  overdue_first_review: "review_cv",
  assessment_past_due: "chase_assessment",
  interview_overdue: "close_out_interview",
  employer_approval_awaiting: "chase_employer",
  stalled_in_stage: "advance_or_reject",
  missing_screening_notes: "add_screening_note",
  offer_awaiting_response: "chase_offer_response",
  hire_awaiting_placement: "record_placement",
  candidate_update_overdue: "update_candidate",
};

export function nextActionForKind(kind: AttentionKind): NextAction {
  return NEXT_ACTION_BY_KIND[kind];
}

export const ATTENTION_KIND_LABELS: Record<AttentionKind, string> = {
  overdue_first_review: "Overdue first review",
  assessment_past_due: "Assessment past due",
  interview_overdue: "Interview overdue",
  employer_approval_awaiting: "Employer approval awaiting",
  stalled_in_stage: "Stalled in stage",
  missing_screening_notes: "Missing screening notes",
  offer_awaiting_response: "Offer awaiting response",
  hire_awaiting_placement: "Hire awaiting placement / invoice",
  candidate_update_overdue: "Candidate update overdue",
};

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  review_cv: "Review the CV",
  add_screening_note: "Add screening notes",
  chase_assessment: "Chase / grade the assessment",
  close_out_interview: "Close out the interview",
  chase_employer: "Chase the employer decision",
  advance_or_reject: "Advance or reject",
  chase_offer_response: "Chase the offer response",
  record_placement: "Record the placement / invoice",
  update_candidate: "Send the candidate an update",
};

export type OwnerSource = "assigned_recruiter" | "job_owner" | "viewer";

export interface AttentionItem {
  /** Stable within a build — `kind:applicationId:sourceId`. */
  id: string;
  kind: AttentionKind;
  nextAction: NextAction;
  applicationId: string;
  ownerUserId: string;
  ownerSource: OwnerSource;
  /** Null only where the source row genuinely records no deadline. */
  dueAt: string | null;
  /** Positive when past due; null when there is no deadline to be past. */
  overdueHours: number | null;
  stage: string;
  /** Assessment / interview / offer / submission id behind the item. */
  sourceId: string | null;
  detail: string;
}

export interface AttentionQueue {
  items: AttentionItem[];
  countsByKind: Record<AttentionKind, number>;
  overdueCountsByKind: Record<AttentionKind, number>;
  totalOverdue: number;
  appIdsByKind: Record<AttentionKind, string[]>;
  generatedAt: string;
}

export interface AttentionInput {
  /** Viewing recruiter — the scope the queue was loaded for. */
  recruiterId: string;
  nowIso: string;
  apps: ApplicationSnapshot[];
  history: StageHistoryEvent[];
  assessments: AssessmentSnapshot[];
  interviews: InterviewSnapshot[];
  offers: OfferSnapshot[];
  submissions: SubmissionSnapshot[];
  /** Applications that already have at least one screening note. */
  appIdsWithScreeningNotes: Set<string>;
  /** stage_key → max hours, from kpi_stage_age_thresholds. */
  stageThresholds: Record<string, number>;
  firstReviewTargetHours: number;
  /** job_order_id → owning recruiter, for the ownership fallback. */
  jobOwnerByJobOrder: Map<string, string | null>;
  /** application_id → last staff→candidate update. */
  lastCandidateUpdateByApp: Map<string, string>;
  maxCandidateSilenceHours: number;
  hiredAppIdsAwaitingPlacement: Set<string>;
}

const CLOSED_ASSESSMENT_STATUSES = new Set(["graded", "cancelled", "expired"]);
const CLOSED_INTERVIEW_STATUSES = new Set(["completed", "cancelled", "no_show"]);
const OPEN_OFFER_STATUSES = new Set(["sent", "negotiating"]);

function overdueHours(dueAt: string | null, nowIso: string): number | null {
  if (!dueAt || dueAt >= nowIso) return null;
  return round1(hoursBetween(dueAt, nowIso));
}

/**
 * assigned recruiter → job owner → viewer. The viewer fallback is safe because
 * the caller only ever passes rows already scoped to that recruiter.
 */
export function resolveOwner(
  app: ApplicationSnapshot,
  jobOwnerByJobOrder: Map<string, string | null>,
  viewerId: string,
): { ownerUserId: string; ownerSource: OwnerSource } {
  if (app.assignedRecruiterId) {
    return { ownerUserId: app.assignedRecruiterId, ownerSource: "assigned_recruiter" };
  }
  const jobOwner = jobOwnerByJobOrder.get(app.jobOrderId);
  if (jobOwner) return { ownerUserId: jobOwner, ownerSource: "job_owner" };
  return { ownerUserId: viewerId, ownerSource: "viewer" };
}

function emptyCounts(): Record<AttentionKind, number> {
  return Object.fromEntries(ATTENTION_KINDS.map((k) => [k, 0])) as Record<AttentionKind, number>;
}

function emptyAppIds(): Record<AttentionKind, string[]> {
  return Object.fromEntries(ATTENTION_KINDS.map((k) => [k, [] as string[]])) as Record<
    AttentionKind,
    string[]
  >;
}

/**
 * Build the daily queue. Overdue items first, then longest-waiting; every item
 * carries owner, next action, due date, and application id.
 */
export function buildAttentionQueue(input: AttentionInput): AttentionQueue {
  const { nowIso, recruiterId, jobOwnerByJobOrder } = input;
  const appById = new Map(input.apps.map((a) => [a.id, a]));
  const items: AttentionItem[] = [];

  const push = (
    kind: AttentionKind,
    applicationId: string,
    sourceId: string | null,
    dueAt: string | null,
    detail: string,
  ) => {
    const app = appById.get(applicationId);
    if (!app) return; // never emit an item for an application outside the loaded scope
    const owner = resolveOwner(app, jobOwnerByJobOrder, recruiterId);
    items.push({
      id: `${kind}:${applicationId}:${sourceId ?? "-"}`,
      kind,
      nextAction: nextActionForKind(kind),
      applicationId,
      ownerUserId: owner.ownerUserId,
      ownerSource: owner.ownerSource,
      dueAt,
      overdueHours: overdueHours(dueAt, nowIso),
      stage: app.currentStage,
      sourceId,
      detail,
    });
  };

  // 1. Overdue first reviews — assigned, open, never reviewed, past target age.
  for (const appId of awaitingFirstReviewAppIds(input.apps, input.history, recruiterId)) {
    const app = appById.get(appId);
    if (!app) continue;
    const dueAt = new Date(
      new Date(app.createdAt).getTime() + input.firstReviewTargetHours * 3_600_000,
    ).toISOString();
    if (dueAt >= nowIso) continue;
    push(
      "overdue_first_review",
      appId,
      null,
      dueAt,
      `Applied ${app.createdAt.slice(0, 10)}; first review target ${input.firstReviewTargetHours}h`,
    );
  }

  // 2. Assessments past due_at and not yet closed out.
  for (const a of input.assessments) {
    if (!a.dueAt) continue;
    if (CLOSED_ASSESSMENT_STATUSES.has(a.status)) continue;
    if (a.dueAt >= nowIso) continue;
    push("assessment_past_due", a.applicationId, a.id, a.dueAt, `Assessment status ${a.status}`);
  }

  // 3. Interviews whose scheduled slot has passed without an outcome.
  for (const i of input.interviews) {
    if (!i.scheduledAt) continue;
    if (CLOSED_INTERVIEW_STATUSES.has(i.status)) continue;
    if (i.scheduledAt >= nowIso) continue;
    push(
      "interview_overdue",
      i.applicationId,
      i.id,
      i.scheduledAt,
      `Interview status ${i.status}; slot has passed`,
    );
  }

  // 4. Employer packs sitting with the employer.
  for (const s of computeEmployerApprovalsAwaiting(input.submissions)) {
    if (!s.applicationId) continue;
    push(
      "employer_approval_awaiting",
      s.applicationId,
      s.id,
      s.responseDueAt ?? null,
      s.responseDueAt
        ? `Employer decision due ${s.responseDueAt.slice(0, 10)} (status ${s.status})`
        : `Awaiting employer decision (status ${s.status}); no deadline recorded`,
    );
  }

  // 5. Stalled past the configured stage threshold.
  for (const s of computeStalledApplications(
    input.apps,
    input.history,
    input.stageThresholds,
    nowIso,
    recruiterId,
  )) {
    push(
      "stalled_in_stage",
      s.applicationId,
      null,
      s.dueAt,
      `${round1(s.hoursInStage)}h in ${s.stage} (threshold ${s.thresholdHours}h)`,
    );
  }

  // 6. Missing screening notes — blocks the CV review gate.
  for (const appId of computeMissingScreeningNotes(
    input.apps,
    input.appIdsWithScreeningNotes,
    recruiterId,
  )) {
    push(
      "missing_screening_notes",
      appId,
      null,
      null,
      "Cannot advance past CV Review until a screening note exists",
    );
  }

  // 7. Offers awaiting a response.
  for (const o of input.offers) {
    if (!OPEN_OFFER_STATUSES.has(o.status)) continue;
    push(
      "offer_awaiting_response",
      o.applicationId,
      o.id,
      o.expiresAt,
      `Offer ${o.status}${o.expiresAt ? `, expires ${o.expiresAt.slice(0, 10)}` : ""}`,
    );
  }

  // 8. Hires with no placement/invoice recorded yet.
  for (const appId of input.hiredAppIdsAwaitingPlacement) {
    push("hire_awaiting_placement", appId, null, null, "Hired but no placement / invoice recorded");
  }

  // 9. Candidate has heard nothing for too long.
  for (const u of computeOverdueCandidateUpdates(
    input.apps,
    input.history,
    input.lastCandidateUpdateByApp,
    nowIso,
    input.maxCandidateSilenceHours,
    recruiterId,
  )) {
    push(
      "candidate_update_overdue",
      u.applicationId,
      null,
      u.dueAt,
      `${u.hoursSinceUpdate ?? 0}h since the candidate last heard from us`,
    );
  }

  items.sort(sortAttention);

  const countsByKind = emptyCounts();
  const overdueCountsByKind = emptyCounts();
  const appIdsByKind = emptyAppIds();
  for (const item of items) {
    countsByKind[item.kind] += 1;
    if (item.overdueHours != null) overdueCountsByKind[item.kind] += 1;
    if (!appIdsByKind[item.kind].includes(item.applicationId)) {
      appIdsByKind[item.kind].push(item.applicationId);
    }
  }

  return {
    items,
    countsByKind,
    overdueCountsByKind,
    totalOverdue: items.filter((i) => i.overdueHours != null).length,
    appIdsByKind,
    generatedAt: nowIso,
  };
}

/** Overdue first, longest overdue first, then items with a deadline, then the rest. */
export function sortAttention(a: AttentionItem, b: AttentionItem): number {
  const aOver = a.overdueHours ?? -1;
  const bOver = b.overdueHours ?? -1;
  if (aOver !== bOver) return bOver - aOver;
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.applicationId.localeCompare(b.applicationId);
}

/**
 * Defence in depth: drop any item whose application is outside the caller's
 * allowed set. Loaders are already scoped by RLS + assignment; this makes a
 * scoping regression fail closed instead of leaking another recruiter's work.
 */
export function restrictToScope(
  queue: AttentionQueue,
  allowedApplicationIds: Set<string>,
): AttentionQueue {
  const items = queue.items.filter((i) => allowedApplicationIds.has(i.applicationId));
  const countsByKind = emptyCounts();
  const overdueCountsByKind = emptyCounts();
  const appIdsByKind = emptyAppIds();
  for (const item of items) {
    countsByKind[item.kind] += 1;
    if (item.overdueHours != null) overdueCountsByKind[item.kind] += 1;
    if (!appIdsByKind[item.kind].includes(item.applicationId)) {
      appIdsByKind[item.kind].push(item.applicationId);
    }
  }
  return {
    items,
    countsByKind,
    overdueCountsByKind,
    totalOverdue: items.filter((i) => i.overdueHours != null).length,
    appIdsByKind,
    generatedAt: queue.generatedAt,
  };
}

/** Applications a recruiter is allowed to see in KPI drill-downs. */
export function scopedApplicationIds(
  apps: ApplicationSnapshot[],
  history: StageHistoryEvent[],
  recruiterId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const a of apps) {
    if (a.assignedRecruiterId === recruiterId) ids.add(a.id);
  }
  // Apps the recruiter acted on keep their historical review credit even after
  // reassignment, so they stay visible in that recruiter's own drill-downs.
  for (const e of history) {
    if (e.actorId === recruiterId) ids.add(e.applicationId);
  }
  return ids;
}

/** Open, non-terminal applications assigned to the recruiter (denominator helper). */
export function openAssignedAppIds(apps: ApplicationSnapshot[], recruiterId: string): string[] {
  return apps
    .filter(
      (a) =>
        a.assignedRecruiterId === recruiterId &&
        !a.withdrawnAt &&
        !TERMINAL_STAGES.has(a.currentStage),
    )
    .map((a) => a.id);
}
