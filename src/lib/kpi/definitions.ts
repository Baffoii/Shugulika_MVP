/**
 * Pure KPI math — no I/O. Used by recruiter / franchise / HQ loaders and unit tests.
 *
 * Attribution rules (MVP):
 * - Review / conversion actions → stage-history actor_id (or assessment grader).
 * - Active workload → current applications.assigned_recruiter_id.
 * - Placements → placements.recruiter_id when set, else app assigned recruiter.
 * - Reassigned apps: historical review credit stays with the actor; workload moves.
 */

export type KpiStatus = "on_target" | "at_risk" | "off_target" | "insufficient_data";

export type TargetSource = "platform" | "franchise" | "recruiter_override";

export type KpiPeriod = "7d" | "30d" | "90d" | "ytd" | "custom";

export interface DateWindow {
  /** Inclusive start (UTC ISO). */
  since: string;
  /** Exclusive end (UTC ISO). */
  until: string;
}

export interface MetricResult<T = number> {
  value: T | null;
  numerator: number;
  denominator: number;
  sampleSize: number;
  status: KpiStatus;
  unavailableReason?: string;
}

export interface StageHistoryEvent {
  applicationId: string;
  fromStage: string | null;
  toStage: string;
  actorId: string | null;
  createdAt: string;
  reason?: string | null;
}

export interface ApplicationSnapshot {
  id: string;
  assignedRecruiterId: string | null;
  currentStage: string;
  createdAt: string;
  withdrawnAt: string | null;
  rejectedAt: string | null;
  rejectedFromStage: string | null;
  rejectionReason: string | null;
  jobOrderId: string;
  owningOrgId: string;
}

export interface AssessmentSnapshot {
  id: string;
  applicationId: string;
  status: string;
  score: number | null;
  passThreshold: number | null;
  humanReviewRequired: boolean;
  gradedAt: string | null;
  dueAt: string | null;
  graderId: string | null;
}

export interface SubmissionSnapshot {
  id: string;
  applicationId: string | null;
  status: string;
  submittedAt: string | null;
  updatedAt: string;
  submittingOrgId: string;
}

export interface OfferSnapshot {
  id: string;
  applicationId: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  expiresAt: string | null;
  owningOrgId: string;
}

export interface PlacementSnapshot {
  id: string;
  applicationId: string;
  offerId: string | null;
  recruiterId: string | null;
  status: string;
  fee: number | null;
  createdAt: string;
  owningOrgId: string;
}

export interface InterviewSnapshot {
  id: string;
  applicationId: string;
  status: string;
  scheduledAt: string | null;
}

export interface JobPublishSnapshot {
  jobOrderId: string;
  publishedAt: string | null;
  jobStatus: string;
}

export interface RejectionReasonCatalog {
  key: string;
  label: string;
}

/** Stages that count as a meaningful review action when moved into. */
export const MEANINGFUL_REVIEW_TO_STAGES = new Set([
  "testing",
  "test_review",
  "interview_screening",
  "interview_review",
  "reference_checks",
  "client_submission",
  "offer",
  "hired",
  "rejected",
]);

/** Leaving CV review (advance) counts as completing CV review. */
export const CV_REVIEW_COMPLETED_TO = new Set([
  "testing",
  "test_review",
  "interview_screening",
  "interview_review",
  "reference_checks",
  "client_submission",
  "offer",
  "hired",
  "rejected",
]);

export const POST_CV_STAGES = new Set([
  "testing",
  "test_review",
  "interview_screening",
  "interview_review",
  "reference_checks",
  "client_submission",
  "offer",
  "hired",
]);

export const POST_INTERVIEW_STAGES = new Set(["client_submission", "offer", "hired"]);

export const TERMINAL_STAGES = new Set(["rejected", "hired", "closed", "invoiced"]);

export const ACCEPTED_SUBMISSION_STATUSES = new Set([
  "shortlisted",
  "interview_requested",
  "offered",
]);

export const FINALIZED_OFFER_STATUSES = new Set(["accepted", "declined", "expired", "withdrawn"]);

export const VALID_PLACEMENT_STATUSES = new Set([
  "active",
  "guarantee_period",
  "completed",
  "replaced",
]);

export function periodToWindow(
  period: KpiPeriod,
  now: Date = new Date(),
  custom?: { since: string; until: string },
): DateWindow {
  if (period === "custom" && custom) {
    return { since: custom.since, until: custom.until };
  }
  const until = now.toISOString();
  const start = new Date(now);
  if (period === "7d") start.setUTCDate(start.getUTCDate() - 7);
  else if (period === "30d") start.setUTCDate(start.getUTCDate() - 30);
  else if (period === "90d") start.setUTCDate(start.getUTCDate() - 90);
  else if (period === "ytd") {
    start.setUTCMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    start.setUTCDate(start.getUTCDate() - 30);
  }
  return { since: start.toISOString(), until };
}

/** Inclusive start, exclusive end. */
export function inWindow(iso: string, window: DateWindow): boolean {
  return iso >= window.since && iso < window.until;
}

export function hoursBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 3_600_000;
}

export function daysBetween(aIso: string, bIso: string): number {
  return hoursBetween(aIso, bIso) / 24;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round1((numerator / denominator) * 100);
}

export function compareLowerIsBetter(
  value: number | null,
  target: number,
  sampleSize: number,
  atRiskFactor = 1.1,
): KpiStatus {
  if (sampleSize <= 0 || value == null) return "insufficient_data";
  if (value <= target) return "on_target";
  if (value <= target * atRiskFactor) return "at_risk";
  return "off_target";
}

export function compareHigherIsBetter(
  value: number | null,
  target: number,
  sampleSize: number,
  atRiskFactor = 0.85,
): KpiStatus {
  if (sampleSize <= 0 || value == null) return "insufficient_data";
  if (value >= target) return "on_target";
  if (value >= target * atRiskFactor) return "at_risk";
  return "off_target";
}

export function compareMaxCount(value: number | null, max: number, sampleSize: number): KpiStatus {
  if (sampleSize <= 0 && value == null) return "insufficient_data";
  const v = value ?? 0;
  if (v <= max) return "on_target";
  if (v <= max * 1.25) return "at_risk";
  return "off_target";
}

function metric(
  value: number | null,
  numerator: number,
  denominator: number,
  status: KpiStatus,
  unavailableReason?: string,
): MetricResult {
  return {
    value,
    numerator,
    denominator,
    sampleSize: denominator,
    status: unavailableReason ? "insufficient_data" : status,
    unavailableReason,
  };
}

/** Collapse duplicate consecutive identical to_stage rows per application. */
export function dedupeStageHistory(events: StageHistoryEvent[]): StageHistoryEvent[] {
  const byApp = new Map<string, StageHistoryEvent[]>();
  for (const e of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const list = byApp.get(e.applicationId) ?? [];
    const prev = list[list.length - 1];
    if (prev && prev.toStage === e.toStage) continue;
    list.push(e);
    byApp.set(e.applicationId, list);
  }
  return [...byApp.values()].flat();
}

export function isMeaningfulReviewEvent(e: StageHistoryEvent): boolean {
  if (e.toStage === "rejected") return true;
  if (MEANINGFUL_REVIEW_TO_STAGES.has(e.toStage) && e.fromStage !== e.toStage) return true;
  return false;
}

export function firstReviewByApp(
  history: StageHistoryEvent[],
  recruiterId?: string,
): Map<string, StageHistoryEvent> {
  const map = new Map<string, StageHistoryEvent>();
  const sorted = dedupeStageHistory(history).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    if (!isMeaningfulReviewEvent(e)) continue;
    if (recruiterId && e.actorId !== recruiterId) continue;
    if (!map.has(e.applicationId)) map.set(e.applicationId, e);
  }
  return map;
}

export function firstReachedAt(
  history: StageHistoryEvent[],
  stages: string[],
): Map<string, string> {
  const stageSet = new Set(stages);
  const map = new Map<string, string>();
  for (const e of dedupeStageHistory(history).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    if (stageSet.has(e.toStage) && !map.has(e.applicationId)) {
      map.set(e.applicationId, e.createdAt);
    }
  }
  return map;
}

export function computeApplicationsReviewed(
  history: StageHistoryEvent[],
  window: DateWindow,
  recruiterId: string,
): MetricResult {
  const apps = new Set<string>();
  for (const e of history) {
    if (e.actorId !== recruiterId) continue;
    if (!inWindow(e.createdAt, window)) continue;
    if (!isMeaningfulReviewEvent(e)) continue;
    apps.add(e.applicationId);
  }
  const n = apps.size;
  return metric(n, n, n, n > 0 ? "on_target" : "insufficient_data");
}

export function computeActiveWorkload(
  apps: ApplicationSnapshot[],
  recruiterId: string,
  closedJobOrderIds: Set<string> = new Set(),
): { total: number; byStage: Record<string, number>; appIds: string[] } {
  const byStage: Record<string, number> = {};
  const appIds: string[] = [];
  for (const a of apps) {
    if (a.assignedRecruiterId !== recruiterId) continue;
    if (a.withdrawnAt) continue;
    if (TERMINAL_STAGES.has(a.currentStage)) continue;
    if (closedJobOrderIds.has(a.jobOrderId)) continue;
    byStage[a.currentStage] = (byStage[a.currentStage] ?? 0) + 1;
    appIds.push(a.id);
  }
  return { total: appIds.length, byStage, appIds };
}

export function computeTimeToFirstReview(
  apps: ApplicationSnapshot[],
  history: StageHistoryEvent[],
  window: DateWindow,
  recruiterId: string,
  targetHours: number,
): MetricResult & { awaitingFirstReview: number; hours: number[] } {
  const first = firstReviewByApp(history, recruiterId);
  const hours: number[] = [];
  let awaiting = 0;
  for (const a of apps) {
    if (a.assignedRecruiterId !== recruiterId && !first.has(a.id)) continue;
    const ev = first.get(a.id);
    if (!ev) {
      if (
        a.assignedRecruiterId === recruiterId &&
        !a.withdrawnAt &&
        !TERMINAL_STAGES.has(a.currentStage)
      ) {
        awaiting += 1;
      }
      continue;
    }
    if (!inWindow(ev.createdAt, window)) continue;
    hours.push(hoursBetween(a.createdAt, ev.createdAt));
  }
  const med = median(hours);
  const value = med == null ? null : round1(med);
  return {
    ...metric(
      value,
      hours.length,
      hours.length,
      compareLowerIsBetter(value, targetHours, hours.length),
    ),
    awaitingFirstReview: awaiting,
    hours,
  };
}

export function computeTimeInStage(
  history: StageHistoryEvent[],
  window: DateWindow,
): { byStage: Record<string, MetricResult>; dwellHours: Record<string, number[]> } {
  const byApp = new Map<string, StageHistoryEvent[]>();
  for (const e of dedupeStageHistory(history)) {
    const list = byApp.get(e.applicationId) ?? [];
    list.push(e);
    byApp.set(e.applicationId, list);
  }
  const dwellHours: Record<string, number[]> = {};
  for (const events of byApp.values()) {
    const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]!;
      const next = sorted[i + 1]!;
      // Completed stage exit during window (exit event date).
      if (!inWindow(next.createdAt, window)) continue;
      const stage = cur.toStage;
      if (TERMINAL_STAGES.has(stage)) continue;
      const h = hoursBetween(cur.createdAt, next.createdAt);
      (dwellHours[stage] ??= []).push(h);
    }
  }
  const byStage: Record<string, MetricResult> = {};
  for (const [stage, vals] of Object.entries(dwellHours)) {
    const med = median(vals);
    const value = med == null ? null : round1(med);
    byStage[stage] = metric(
      value,
      vals.length,
      vals.length,
      value == null ? "insufficient_data" : "on_target",
    );
  }
  return { byStage, dwellHours };
}

export function computeStalledByStage(
  apps: ApplicationSnapshot[],
  history: StageHistoryEvent[],
  thresholds: Record<string, number>,
  nowIso: string,
  recruiterId?: string,
): { total: number; byStage: Record<string, number> } {
  const firstInCurrent = new Map<string, string>();
  const sorted = dedupeStageHistory(history).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    firstInCurrent.set(e.applicationId, e.createdAt);
  }
  const byStage: Record<string, number> = {};
  let total = 0;
  for (const a of apps) {
    if (recruiterId && a.assignedRecruiterId !== recruiterId) continue;
    if (a.withdrawnAt || TERMINAL_STAGES.has(a.currentStage)) continue;
    const maxH = thresholds[a.currentStage];
    if (maxH == null) continue;
    const entered = firstInCurrent.get(a.id) ?? a.createdAt;
    if (hoursBetween(entered, nowIso) > maxH) {
      byStage[a.currentStage] = (byStage[a.currentStage] ?? 0) + 1;
      total += 1;
    }
  }
  return { total, byStage };
}

export function computeTimeToClientSubmission(
  apps: ApplicationSnapshot[],
  history: StageHistoryEvent[],
  window: DateWindow,
  targetDays: number,
  recruiterId?: string,
): MetricResult {
  const appById = new Map(apps.map((a) => [a.id, a]));
  const days: number[] = [];
  const seen = new Set<string>();

  for (const e of dedupeStageHistory(history).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    if (e.toStage !== "client_submission") continue;
    if (seen.has(e.applicationId)) continue;
    if (recruiterId && e.actorId !== recruiterId) continue;
    if (!inWindow(e.createdAt, window)) continue;
    const a = appById.get(e.applicationId);
    if (!a) continue;
    seen.add(e.applicationId);
    days.push(daysBetween(a.createdAt, e.createdAt));
  }

  const med = median(days);
  const value = med == null ? null : round1(med);
  return metric(
    value,
    days.length,
    days.length,
    compareLowerIsBetter(value, targetDays, days.length),
  );
}

export function computeTimeToFill(
  placements: PlacementSnapshot[],
  jobs: JobPublishSnapshot[],
  window: DateWindow,
  targetDays: number,
  recruiterId?: string,
  hiredAtByApp?: Map<string, string>,
  appJobOrder?: Map<string, string>,
): MetricResult {
  const publishedByJob = new Map(
    jobs.filter((j) => j.publishedAt).map((j) => [j.jobOrderId, j.publishedAt!] as const),
  );
  const days: number[] = [];

  for (const p of placements) {
    if (recruiterId && p.recruiterId && p.recruiterId !== recruiterId) continue;
    if (recruiterId && !p.recruiterId) continue; // require attribution when filtering
    if (!VALID_PLACEMENT_STATUSES.has(p.status) && p.status !== "failed") continue;
    if (p.status === "failed") continue;
    if (!inWindow(p.createdAt, window)) continue;
    const jobOrderId = appJobOrder?.get(p.applicationId);
    const published = jobOrderId ? publishedByJob.get(jobOrderId) : undefined;
    if (!published) continue;
    days.push(daysBetween(published, p.createdAt));
  }

  // If no placements, do not fall back to hired stage for the rate value —
  // return insufficient / unavailable.
  if (days.length === 0) {
    // Optional: if hiredAt provided and no placements at all in dataset, mark unavailable
    const hasAnyPlacement = placements.some((p) =>
      recruiterId ? p.recruiterId === recruiterId : true,
    );
    if (!hasAnyPlacement && (!hiredAtByApp || hiredAtByApp.size === 0)) {
      return metric(null, 0, 0, "insufficient_data", "No placements in period");
    }
    if (!hasAnyPlacement) {
      return metric(
        null,
        0,
        0,
        "insufficient_data",
        "Time to fill requires placement records (jobs.published_at → placements.created_at)",
      );
    }
    return metric(null, 0, 0, "insufficient_data");
  }

  const med = median(days);
  const value = med == null ? null : round1(med);
  return metric(
    value,
    days.length,
    days.length,
    compareLowerIsBetter(value, targetDays, days.length),
  );
}

export function computeCvReviewConversion(
  history: StageHistoryEvent[],
  window: DateWindow,
  recruiterId: string,
): MetricResult {
  const reviewed = new Set<string>();
  const advanced = new Set<string>();
  const sorted = dedupeStageHistory(history).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    if (e.actorId !== recruiterId) continue;
    if (e.fromStage === "cv_review" && CV_REVIEW_COMPLETED_TO.has(e.toStage)) {
      if (inWindow(e.createdAt, window)) reviewed.add(e.applicationId);
    }
  }
  // Numerator: among reviewed, later reached post-CV stages (any time after review)
  for (const appId of reviewed) {
    const later = sorted.some(
      (e) => e.applicationId === appId && POST_CV_STAGES.has(e.toStage) && e.toStage !== "rejected",
    );
    if (later) advanced.add(appId);
  }
  const den = reviewed.size;
  const num = advanced.size;
  const value = pct(num, den);
  return metric(value, num, den, value == null ? "insufficient_data" : "on_target");
}

export function computeTestingPassRate(
  assessments: AssessmentSnapshot[],
  window: DateWindow,
): MetricResult {
  const eligible = assessments.filter((a) => {
    if (a.status !== "graded") return false;
    if (a.humanReviewRequired) return false;
    if (a.score == null || a.passThreshold == null) return false;
    const at = a.gradedAt;
    if (!at || !inWindow(at, window)) return false;
    return true;
  });
  const passed = eligible.filter((a) => (a.score as number) >= (a.passThreshold as number));
  const den = eligible.length;
  const num = passed.length;
  const value = pct(num, den);
  return metric(value, num, den, value == null ? "insufficient_data" : "on_target");
}

export function computeInterviewConversion(
  history: StageHistoryEvent[],
  window: DateWindow,
  recruiterId: string,
  targetPct: number,
): MetricResult {
  const completed = new Set<string>();
  const converted = new Set<string>();
  const sorted = dedupeStageHistory(history).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of sorted) {
    if (e.actorId !== recruiterId) continue;
    if (e.toStage === "interview_review" && inWindow(e.createdAt, window)) {
      completed.add(e.applicationId);
    }
  }
  for (const appId of completed) {
    const ok = sorted.some(
      (e) => e.applicationId === appId && POST_INTERVIEW_STAGES.has(e.toStage),
    );
    if (ok) converted.add(appId);
  }
  const den = completed.size;
  const num = converted.size;
  const value = pct(num, den);
  return metric(value, num, den, compareHigherIsBetter(value, targetPct, den));
}

export function computeClientSubmissionAcceptance(
  submissions: SubmissionSnapshot[],
  window: DateWindow,
  targetPct: number,
): MetricResult {
  const decided = submissions.filter((s) => {
    if (["consent_pending", "submitted", "viewed"].includes(s.status)) return false;
    const at = s.updatedAt;
    return inWindow(at, window);
  });
  const accepted = decided.filter((s) => ACCEPTED_SUBMISSION_STATUSES.has(s.status));
  const den = decided.length;
  const num = accepted.length;
  const value = pct(num, den);
  return metric(value, num, den, compareHigherIsBetter(value, targetPct, den));
}

export function computeOfferToHire(
  offers: OfferSnapshot[],
  placements: PlacementSnapshot[],
  window: DateWindow,
  targetPct: number,
): MetricResult {
  const finalized = offers.filter(
    (o) => FINALIZED_OFFER_STATUSES.has(o.status) && inWindow(o.updatedAt, window),
  );
  if (finalized.length === 0) {
    return metric(
      null,
      0,
      0,
      "insufficient_data",
      "No finalized offer records in period. Offer-to-hire requires offers.status in accepted/declined/expired/withdrawn — not Hired stage alone.",
    );
  }
  const placementByOffer = new Set(
    placements
      .filter((p) => p.offerId && VALID_PLACEMENT_STATUSES.has(p.status))
      .map((p) => p.offerId as string),
  );
  const hired = finalized.filter((o) => o.status === "accepted" && placementByOffer.has(o.id));
  // Accepted without placement still counts as accepted offer → hire only with placement
  const num = hired.length;
  const den = finalized.length;
  const value = pct(num, den);
  return metric(value, num, den, compareHigherIsBetter(value, targetPct, den));
}

export function computePlacementRate(
  history: StageHistoryEvent[],
  placements: PlacementSnapshot[],
  window: DateWindow,
  targetPct: number,
  recruiterId?: string,
): MetricResult {
  const csApps = new Set<string>();
  for (const e of dedupeStageHistory(history)) {
    if (e.toStage !== "client_submission") continue;
    if (!inWindow(e.createdAt, window)) continue;
    if (recruiterId && e.actorId !== recruiterId) continue;
    csApps.add(e.applicationId);
  }
  const placed = new Set(
    placements
      .filter((p) => {
        if (!VALID_PLACEMENT_STATUSES.has(p.status)) return false;
        if (recruiterId && p.recruiterId && p.recruiterId !== recruiterId) return false;
        return csApps.has(p.applicationId);
      })
      .map((p) => p.applicationId),
  );
  const den = csApps.size;
  const num = [...csApps].filter((id) => placed.has(id)).length;
  const value = pct(num, den);
  return metric(value, num, den, compareHigherIsBetter(value, targetPct, den));
}

export function computeRejectionBreakdown(
  apps: ApplicationSnapshot[],
  window: DateWindow,
  catalog: RejectionReasonCatalog[],
  recruiterId?: string,
  assignedScope?: Set<string>,
): {
  total: number;
  rate: MetricResult;
  byStage: Record<string, number>;
  byReasonKey: Record<string, number>;
  otherReasons: string[];
} {
  const labelToKey = new Map(catalog.map((c) => [c.label.toLowerCase(), c.key]));
  for (const c of catalog) labelToKey.set(c.key.toLowerCase(), c.key);

  const rejected = apps.filter((a) => {
    if (!a.rejectedAt || !inWindow(a.rejectedAt, window)) return false;
    if (recruiterId && a.assignedRecruiterId !== recruiterId) return false;
    if (assignedScope && !assignedScope.has(a.id)) return false;
    return true;
  });

  const byStage: Record<string, number> = {};
  const byReasonKey: Record<string, number> = {};
  const otherReasons: string[] = [];

  for (const a of rejected) {
    const stage = a.rejectedFromStage ?? "unknown";
    byStage[stage] = (byStage[stage] ?? 0) + 1;
    const raw = (a.rejectionReason ?? "").trim();
    const key = labelToKey.get(raw.toLowerCase()) ?? (raw ? null : "unknown");
    if (!key || key === "other") {
      byReasonKey.other = (byReasonKey.other ?? 0) + 1;
      if (raw && key !== "other") otherReasons.push(raw);
      else if (key === "other" && raw) otherReasons.push(raw);
    } else {
      byReasonKey[key] = (byReasonKey[key] ?? 0) + 1;
    }
  }

  const scopeApps = apps.filter((a) => {
    if (recruiterId && a.assignedRecruiterId !== recruiterId) return false;
    if (assignedScope && !assignedScope.has(a.id)) return false;
    // Apps created or active intersecting period — use created_at in window OR rejected in window
    return (
      inWindow(a.createdAt, window) || (a.rejectedAt != null && inWindow(a.rejectedAt, window))
    );
  });
  const den = scopeApps.length;
  const num = rejected.length;
  const value = pct(num, den);

  return {
    total: num,
    rate: metric(value, num, den, value == null ? "insufficient_data" : "on_target"),
    byStage,
    byReasonKey,
    otherReasons,
  };
}

export function computeWithdrawalRate(
  apps: ApplicationSnapshot[],
  window: DateWindow,
  recruiterId: string,
): MetricResult {
  const scoped = apps.filter((a) => a.assignedRecruiterId === recruiterId);
  const withdrawn = scoped.filter((a) => a.withdrawnAt && inWindow(a.withdrawnAt, window));
  // Denominator: assigned apps that existed in period (created before until)
  const den = scoped.filter((a) => a.createdAt < window.until).length;
  const num = withdrawn.length;
  const value = pct(num, den);
  return metric(value, num, den, value == null ? "insufficient_data" : "on_target");
}

export interface SlaQueue {
  awaitingFirstReview: number;
  assessmentsPastDeadline: number;
  interviewsOverdue: number;
  stalledInStage: number;
  offersAwaitingResponse: number;
  hiresAwaitingPlacementOrInvoice: number;
  employerFeedbackOverdue: { supported: false; reason: string };
}

export function computeSlaQueue(input: {
  awaitingFirstReview: number;
  assessments: AssessmentSnapshot[];
  interviews: InterviewSnapshot[];
  stalledTotal: number;
  offers: OfferSnapshot[];
  hiredAppIds: string[];
  placementAppIds: Set<string>;
  invoicedAppIds: Set<string>;
  nowIso: string;
}): SlaQueue {
  const assessmentsPastDeadline = input.assessments.filter((a) => {
    if (!a.dueAt) return false;
    if (["graded", "cancelled", "expired"].includes(a.status)) return false;
    return a.dueAt < input.nowIso;
  }).length;

  const interviewsOverdue = input.interviews.filter((i) => {
    if (!i.scheduledAt) return false;
    if (["completed", "cancelled", "no_show"].includes(i.status)) return false;
    return i.scheduledAt < input.nowIso;
  }).length;

  const offersAwaitingResponse = input.offers.filter(
    (o) => o.status === "sent" || o.status === "negotiating",
  ).length;

  const hiresAwaitingPlacementOrInvoice = input.hiredAppIds.filter(
    (id) => !input.placementAppIds.has(id) || !input.invoicedAppIds.has(id),
  ).length;

  return {
    awaitingFirstReview: input.awaitingFirstReview,
    assessmentsPastDeadline,
    interviewsOverdue,
    stalledInStage: input.stalledTotal,
    offersAwaitingResponse,
    hiresAwaitingPlacementOrInvoice,
    employerFeedbackOverdue: {
      supported: false,
      reason: "No employer feedback deadline field is stored yet.",
    },
  };
}

export function formatDurationHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 48) return `${round1(hours)}h`;
  return `${round1(hours / 24)}d`;
}

export function funnelCounts(
  history: StageHistoryEvent[],
  apps: ApplicationSnapshot[],
): Record<string, number> {
  const stages = [
    "cv_review",
    "testing",
    "interview_review",
    "client_submission",
    "offer",
    "hired",
  ];
  const reached = new Map<string, Set<string>>();
  for (const s of stages) reached.set(s, new Set());
  for (const e of history) {
    if (reached.has(e.toStage)) reached.get(e.toStage)!.add(e.applicationId);
  }
  for (const a of apps) {
    if (reached.has(a.currentStage)) reached.get(a.currentStage)!.add(a.id);
  }
  const out: Record<string, number> = { applied: apps.filter((a) => !a.withdrawnAt).length };
  for (const s of stages) out[s] = reached.get(s)?.size ?? 0;
  return out;
}
