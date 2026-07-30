/**
 * KPI data loaders — RLS-scoped Supabase reads + pure math from @/lib/kpi/definitions.
 * No service-role. Shared by recruiter, franchise, and HQ portals.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationRow,
  ApplicationStageHistoryRow,
  AssessmentAssignmentRow,
  EmployerSubmissionRow,
  InvoiceRow,
  JobOrderRow,
  JobRoleRow,
  MembershipRow,
  OfferRow,
  PlacementRow,
  ProfileRow,
  RecruiterKpiTargetRow,
  RecruiterRoleAssignmentRow,
  InterviewRow,
  KpiStageAgeThresholdRow,
} from "@/lib/database.types";
import { normalizeRecruiterLevel, type RecruiterLevel, RECRUITER_LEVELS } from "@/lib/rbac";
import { REJECTION_REASONS } from "@/lib/constants";
import {
  type KpiPeriod,
  type KpiStatus,
  type MetricResult,
  type TargetSource,
  type DateWindow,
  type SlaQueue,
  type ApplicationSnapshot,
  type StageHistoryEvent,
  type AssessmentSnapshot,
  type SubmissionSnapshot,
  type OfferSnapshot,
  type PlacementSnapshot,
  type InterviewSnapshot,
  type JobPublishSnapshot,
  periodToWindow,
  computeApplicationsReviewed,
  computeActiveWorkload,
  computeTimeToFirstReview,
  computeTimeInStage,
  computeStalledByStage,
  computeTimeToClientSubmission,
  computeTimeToFill,
  computeCvReviewConversion,
  computeTestingPassRate,
  computeInterviewConversion,
  computeClientSubmissionAcceptance,
  computeOfferToHire,
  computePlacementRate,
  computeRejectionBreakdown,
  computeWithdrawalRate,
  computeSlaQueue,
  funnelCounts,
  compareMaxCount,
  formatDurationHours,
  firstReviewByApp,
  hoursBetween,
  median,
} from "@/lib/kpi/definitions";

export type { KpiPeriod, KpiStatus, MetricResult, TargetSource };
/** @deprecated Use KpiPeriod — kept for existing filter components during migration. */
export type KpiDateRange = "week" | "month" | "quarter" | KpiPeriod;

export type KpiScope = {
  jobRoleId?: string;
  employerOrgId?: string;
  organizationId?: string;
  countryCode?: string;
};

export interface KpiCompany {
  id: string;
  name: string;
  applicationCount: number;
}

export interface KpiTargets {
  maxTimeToFirstReviewHours: number;
  maxTimeToClientSubmissionDays: number;
  timeToFillDays: number;
  placementRatePct: number;
  interviewConversionPct: number;
  clientSubmissionAcceptancePct: number;
  offerToHireRatioPct: number;
  maxActiveWorkload: number;
  maxStalledApplicationCount: number;
  /** Legacy display field — apps reviewed is informational, not a hard target in MVP cards. */
  appsReviewedPerWeek: number;
  source: TargetSource;
}

export interface AssignedRole {
  roleId: string;
  roleName: string;
  region: string | null;
  status: "active" | "inactive" | "archived";
  assignedAt: string;
}

export interface FunnelCounts {
  applied: number;
  shortlisted: number;
  interviewed: number;
  hired: number;
  clientSubmission?: number;
  offer?: number;
  byStage?: Record<string, number>;
}

export interface TimeToFillTrendPoint {
  weekLabel: string;
  weekStart: string;
  avgDays: number | null;
  hiredCount: number;
}

export interface AppsReviewedTrendPoint {
  weekLabel: string;
  weekStart: string;
  count: number;
}

export interface RecruiterKPIs {
  applicationsReviewed: MetricResult;
  activeWorkload: {
    total: number;
    byStage: Record<string, number>;
    status: KpiStatus;
  };
  timeToFirstReview: MetricResult & { awaitingFirstReview: number; display: string };
  timeInStage: Record<string, MetricResult>;
  timeToClientSubmission: MetricResult & { display: string };
  timeToFill: MetricResult & { display: string };
  cvReviewConversion: MetricResult;
  testingPassRate: MetricResult;
  interviewConversion: MetricResult;
  clientSubmissionAcceptance: MetricResult;
  offerToHire: MetricResult;
  placementRate: MetricResult;
  rejections: ReturnType<typeof computeRejectionBreakdown>;
  withdrawalRate: MetricResult;
  sla: SlaQueue;
  funnel: Record<string, number>;
  targets: KpiTargets;
  period: KpiPeriod;
  window: DateWindow;
}

export interface RecruiterComparisonRow {
  recruiterId: string;
  name: string;
  email: string;
  level: RecruiterLevel;
  regionCode: string | null;
  organizationId: string | null;
  organizationName: string | null;
  assignedJobs: number;
  activeWorkload: number;
  applicationsReviewed: number;
  awaitingFirstReview: number;
  medianFirstReviewHours: number | null;
  clientSubmissions: number;
  placements: number;
  placementRate: number | null;
  slaOverdue: number;
  targetStatus: KpiStatus;
}

export interface FranchiseKpiDashboard {
  activeJobs: number;
  activeApplications: number;
  currentPlacements: number;
  placementValue: number | null;
  openInvoices: number;
  paidInvoiceTotal: number;
  unpaidInvoiceTotal: number;
  recruiterHeadcount: number;
  funnel: Record<string, number>;
  medianTimeToFirstReviewHours: number | null;
  medianTimeToClientSubmissionDays: number | null;
  medianTimeToFillDays: number | null;
  placementRate: MetricResult;
  clientSubmissionAcceptance: MetricResult;
  rejectionTotal: number;
  withdrawalTotal: number;
  stalledByStage: Record<string, number>;
  recruiters: RecruiterComparisonRow[];
}

export interface FranchiseComparisonRow {
  organizationId: string;
  organizationName: string;
  countryCode: string | null;
  recruiterHeadcount: number;
  activeJobs: number;
  activeApplications: number;
  placements: number;
  placementRate: number | null;
  medianTimeToFillDays: number | null;
  openInvoices: number;
  slaOverdue: number;
}

/** @deprecated Candidate quality removed from KPI surface. */
export interface CandidateQualityScore {
  averageAptitudeScore: number;
  interviewPerformance: number;
  engagementScore: number;
  overallScore: number;
}

export interface RecruiterWithRoles {
  recruiterId: string;
  name: string;
  email: string;
  level: RecruiterLevel;
  regionCode: string | null;
  organizationId: string | null;
  assignedRoles: string[];
  kpisSummary: {
    timeToFill: number | null;
    placementRate: number | null;
    applicationsReviewedPerWeek: number;
    offerToHireRatio: number | null;
  };
}

// ---- cache ------------------------------------------------------------------
type CacheEntry<T> = { expires: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit || hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}
function cacheSet<T>(key: string, value: T): T {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}
export function clearRecruiterKpiCache() {
  cache.clear();
}

function periodFromLegacy(range: KpiDateRange): KpiPeriod {
  if (range === "week" || range === "7d") return "7d";
  if (range === "quarter" || range === "90d") return "90d";
  if (range === "ytd") return "ytd";
  if (range === "custom") return "custom";
  return "30d";
}

function toAppSnap(a: ApplicationRow): ApplicationSnapshot {
  return {
    id: a.id,
    assignedRecruiterId: a.assigned_recruiter_id,
    currentStage: a.current_stage,
    createdAt: a.created_at,
    withdrawnAt: a.withdrawn_at,
    rejectedAt: a.rejected_at,
    rejectedFromStage: a.rejected_from_stage,
    rejectionReason: a.rejection_reason,
    jobOrderId: a.job_order_id,
    owningOrgId: a.owning_org_id,
  };
}

function toHistSnap(h: ApplicationStageHistoryRow): StageHistoryEvent {
  return {
    applicationId: h.application_id,
    fromStage: h.from_stage,
    toStage: h.to_stage,
    actorId: h.actor_id,
    createdAt: h.created_at,
    reason: h.reason,
  };
}

function rowToTargets(r: RecruiterKpiTargetRow, source: TargetSource): KpiTargets {
  return {
    maxTimeToFirstReviewHours: r.max_time_to_first_review_hours ?? 48,
    maxTimeToClientSubmissionDays: r.max_time_to_client_submission_days ?? 14,
    timeToFillDays: r.target_time_to_fill_days,
    placementRatePct: r.target_placement_rate_pct,
    interviewConversionPct: r.min_interview_conversion_pct ?? 40,
    clientSubmissionAcceptancePct: r.min_client_submission_acceptance_pct ?? 40,
    offerToHireRatioPct: r.target_offer_to_hire_ratio_pct,
    maxActiveWorkload: r.max_active_workload ?? 40,
    maxStalledApplicationCount: r.max_stalled_application_count ?? 10,
    appsReviewedPerWeek: r.target_apps_reviewed_per_week,
    source,
  };
}

const PLATFORM_DEFAULTS: Record<RecruiterLevel, Omit<KpiTargets, "source">> = {
  junior: {
    maxTimeToFirstReviewHours: 72,
    maxTimeToClientSubmissionDays: 21,
    timeToFillDays: 21,
    placementRatePct: 50,
    interviewConversionPct: 30,
    clientSubmissionAcceptancePct: 30,
    offerToHireRatioPct: 40,
    maxActiveWorkload: 25,
    maxStalledApplicationCount: 8,
    appsReviewedPerWeek: 12,
  },
  recruiter: {
    maxTimeToFirstReviewHours: 48,
    maxTimeToClientSubmissionDays: 14,
    timeToFillDays: 14,
    placementRatePct: 70,
    interviewConversionPct: 40,
    clientSubmissionAcceptancePct: 40,
    offerToHireRatioPct: 50,
    maxActiveWorkload: 40,
    maxStalledApplicationCount: 10,
    appsReviewedPerWeek: 20,
  },
  senior: {
    maxTimeToFirstReviewHours: 36,
    maxTimeToClientSubmissionDays: 10,
    timeToFillDays: 12,
    placementRatePct: 75,
    interviewConversionPct: 50,
    clientSubmissionAcceptancePct: 45,
    offerToHireRatioPct: 55,
    maxActiveWorkload: 50,
    maxStalledApplicationCount: 12,
    appsReviewedPerWeek: 25,
  },
  head_recruiter: {
    maxTimeToFirstReviewHours: 24,
    maxTimeToClientSubmissionDays: 7,
    timeToFillDays: 10,
    placementRatePct: 80,
    interviewConversionPct: 55,
    clientSubmissionAcceptancePct: 50,
    offerToHireRatioPct: 60,
    maxActiveWorkload: 60,
    maxStalledApplicationCount: 15,
    appsReviewedPerWeek: 30,
  },
};

export async function getKPITargets(
  recruiterLevel: RecruiterLevel,
  orgId?: string,
): Promise<KpiTargets> {
  const level = normalizeRecruiterLevel(recruiterLevel);
  const key = `targets:${level}:${orgId ?? "global"}`;
  const cached = cacheGet<KpiTargets>(key);
  if (cached) return cached;

  const supabase = createClient();
  const fallback: KpiTargets = { ...PLATFORM_DEFAULTS[level], source: "platform" };

  if (orgId) {
    const { data: orgRow } = await supabase
      .from("recruiter_kpi_targets")
      .select("*")
      .eq("recruiter_level", level)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (orgRow) return cacheSet(key, rowToTargets(orgRow as RecruiterKpiTargetRow, "franchise"));
  }

  const { data: globalRow } = await supabase
    .from("recruiter_kpi_targets")
    .select("*")
    .eq("recruiter_level", level)
    .is("organization_id", null)
    .maybeSingle();

  if (globalRow) return cacheSet(key, rowToTargets(globalRow as RecruiterKpiTargetRow, "platform"));
  return cacheSet(key, fallback);
}

export async function listKpiTargets(orgId?: string | null): Promise<RecruiterKpiTargetRow[]> {
  const supabase = createClient();
  let q = supabase.from("recruiter_kpi_targets").select("*").order("recruiter_level");
  if (orgId === null) q = q.is("organization_id", null);
  else if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error) {
    console.error("[listKpiTargets]", error.message);
    return [];
  }
  return (data as RecruiterKpiTargetRow[] | null) ?? [];
}

export async function upsertKpiTarget(input: {
  recruiterLevel: RecruiterLevel;
  organizationId: string | null;
  patch: Partial<RecruiterKpiTargetRow>;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const level = normalizeRecruiterLevel(input.recruiterLevel);
  // Prefer update-then-insert for partial unique indexes
  let existingQ = supabase.from("recruiter_kpi_targets").select("id").eq("recruiter_level", level);
  existingQ = input.organizationId
    ? existingQ.eq("organization_id", input.organizationId)
    : existingQ.is("organization_id", null);
  const { data: existing } = await existingQ.maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("recruiter_kpi_targets")
      .update(input.patch)
      .eq("id", (existing as { id: string }).id);
    clearRecruiterKpiCache();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }
  const defaults = PLATFORM_DEFAULTS[level];
  const { error } = await supabase.from("recruiter_kpi_targets").insert({
    recruiter_level: level,
    organization_id: input.organizationId,
    target_time_to_fill_days: input.patch.target_time_to_fill_days ?? defaults.timeToFillDays,
    target_placement_rate_pct: input.patch.target_placement_rate_pct ?? defaults.placementRatePct,
    target_apps_reviewed_per_week:
      input.patch.target_apps_reviewed_per_week ?? defaults.appsReviewedPerWeek,
    target_offer_to_hire_ratio_pct:
      input.patch.target_offer_to_hire_ratio_pct ?? defaults.offerToHireRatioPct,
    max_time_to_first_review_hours:
      input.patch.max_time_to_first_review_hours ?? defaults.maxTimeToFirstReviewHours,
    max_time_to_client_submission_days:
      input.patch.max_time_to_client_submission_days ?? defaults.maxTimeToClientSubmissionDays,
    min_interview_conversion_pct:
      input.patch.min_interview_conversion_pct ?? defaults.interviewConversionPct,
    min_client_submission_acceptance_pct:
      input.patch.min_client_submission_acceptance_pct ?? defaults.clientSubmissionAcceptancePct,
    max_active_workload: input.patch.max_active_workload ?? defaults.maxActiveWorkload,
    max_stalled_application_count:
      input.patch.max_stalled_application_count ?? defaults.maxStalledApplicationCount,
  });
  clearRecruiterKpiCache();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function loadStageThresholds(orgId?: string): Promise<Record<string, number>> {
  const supabase = createClient();
  const { data } = await supabase.from("kpi_stage_age_thresholds").select("*");
  const rows = (data as KpiStageAgeThresholdRow[] | null) ?? [];
  const map: Record<string, number> = {};
  for (const r of rows.filter((x) => x.organization_id == null)) {
    map[r.stage_key] = r.max_hours;
  }
  if (orgId) {
    for (const r of rows.filter((x) => x.organization_id === orgId)) {
      map[r.stage_key] = r.max_hours;
    }
  }
  return map;
}

type LoadedContext = {
  apps: ApplicationRow[];
  history: ApplicationStageHistoryRow[];
  jobsById: Map<string, JobOrderRow>;
  assessments: AssessmentAssignmentRow[];
  submissions: EmployerSubmissionRow[];
  offers: OfferRow[];
  placements: PlacementRow[];
  interviews: InterviewRow[];
  invoices: InvoiceRow[];
  publishedByJob: JobPublishSnapshot[];
  closedJobOrderIds: Set<string>;
};

/**
 * Load applications attributed to a recruiter:
 * - currently assigned (workload / ownership)
 * - plus any apps where this recruiter acted in stage history (for review attribution)
 * Does NOT credit all apps on shared job_assignments.
 */
async function loadRecruiterContext(
  recruiterId: string,
  window: DateWindow,
  scope: KpiScope = {},
): Promise<LoadedContext> {
  const supabase = createClient();

  const { data: assignedApps } = await supabase
    .from("applications")
    .select("*")
    .eq("assigned_recruiter_id", recruiterId);

  let apps = (assignedApps as ApplicationRow[] | null) ?? [];

  // History where this recruiter acted (for review metrics) — widen lookback
  const { data: actorHist } = await supabase
    .from("application_stage_history")
    .select("application_id")
    .eq("actor_id", recruiterId)
    .gte("created_at", window.since)
    .lt("created_at", window.until);

  const actorAppIds = [
    ...new Set(
      ((actorHist as { application_id: string }[] | null) ?? []).map((h) => h.application_id),
    ),
  ].filter((id) => !apps.some((a) => a.id === id));

  if (actorAppIds.length > 0) {
    const { data: more } = await supabase.from("applications").select("*").in("id", actorAppIds);
    apps = [...apps, ...((more as ApplicationRow[] | null) ?? [])];
  }

  if (scope.organizationId) {
    apps = apps.filter((a) => a.owning_org_id === scope.organizationId);
  }

  const jobIds = [...new Set(apps.map((a) => a.job_order_id))];
  let jobsById = new Map<string, JobOrderRow>();
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase.from("job_orders").select("*").in("id", jobIds);
    jobsById = new Map(((jobs as JobOrderRow[] | null) ?? []).map((j) => [j.id, j]));
  }

  if (scope.jobRoleId) {
    apps = apps.filter((a) => jobsById.get(a.job_order_id)?.job_role === scope.jobRoleId);
  }
  if (scope.employerOrgId) {
    apps = apps.filter(
      (a) => jobsById.get(a.job_order_id)?.employer_org_id === scope.employerOrgId,
    );
  }
  if (scope.countryCode) {
    apps = apps.filter((a) => jobsById.get(a.job_order_id)?.country_code === scope.countryCode);
  }

  const appIds = apps.map((a) => a.id);
  const empty: LoadedContext = {
    apps: [],
    history: [],
    jobsById,
    assessments: [],
    submissions: [],
    offers: [],
    placements: [],
    interviews: [],
    invoices: [],
    publishedByJob: [],
    closedJobOrderIds: new Set(),
  };
  if (appIds.length === 0) return empty;

  const [
    { data: history },
    { data: assessments },
    { data: submissions },
    { data: offers },
    { data: placements },
    { data: interviews },
    { data: jobsPub },
  ] = await Promise.all([
    supabase.from("application_stage_history").select("*").in("application_id", appIds),
    supabase.from("assessment_assignments").select("*").in("application_id", appIds),
    supabase.from("employer_submissions").select("*").in("application_id", appIds),
    supabase.from("offers").select("*").in("application_id", appIds),
    supabase.from("placements").select("*").in("application_id", appIds),
    supabase.from("interviews").select("*").in("application_id", appIds),
    supabase.from("jobs").select("job_order_id,published_at,status").in("job_order_id", jobIds),
  ]);

  const placementIds = ((placements as PlacementRow[] | null) ?? []).map((p) => p.id);
  let invoices: InvoiceRow[] = [];
  if (placementIds.length > 0) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("*")
      .in("placement_id", placementIds);
    invoices = (inv as InvoiceRow[] | null) ?? [];
  }

  const closedJobOrderIds = new Set(
    [...jobsById.values()]
      .filter((j) => ["cancelled", "closed"].includes(j.status))
      .map((j) => j.id),
  );

  const publishedByJob: JobPublishSnapshot[] = (
    (jobsPub as { job_order_id: string; published_at: string | null; status: string }[] | null) ??
    []
  ).map((j) => ({
    jobOrderId: j.job_order_id,
    publishedAt: j.published_at,
    jobStatus: j.status,
  }));

  return {
    apps,
    history: (history as ApplicationStageHistoryRow[] | null) ?? [],
    jobsById,
    assessments: (assessments as AssessmentAssignmentRow[] | null) ?? [],
    submissions: (submissions as EmployerSubmissionRow[] | null) ?? [],
    offers: (offers as OfferRow[] | null) ?? [],
    placements: (placements as PlacementRow[] | null) ?? [],
    interviews: (interviews as InterviewRow[] | null) ?? [],
    invoices,
    publishedByJob,
    closedJobOrderIds,
  };
}

function buildKpisFromContext(
  recruiterId: string,
  ctx: LoadedContext,
  targets: KpiTargets,
  thresholds: Record<string, number>,
  period: KpiPeriod,
  window: DateWindow,
  nowIso: string,
): RecruiterKPIs {
  const apps = ctx.apps.map(toAppSnap);
  const history = ctx.history.map(toHistSnap);
  const assessments: AssessmentSnapshot[] = ctx.assessments.map((a) => ({
    id: a.id,
    applicationId: a.application_id,
    status: a.status,
    score: a.score,
    passThreshold: a.pass_threshold,
    humanReviewRequired: a.human_review_required,
    gradedAt: a.graded_at,
    dueAt: a.due_at,
    graderId: a.grader_id,
  }));
  const submissions: SubmissionSnapshot[] = ctx.submissions.map((s) => ({
    id: s.id,
    applicationId: s.application_id,
    status: s.status,
    submittedAt: s.submitted_at,
    updatedAt: s.updated_at,
    submittingOrgId: s.submitting_org_id,
  }));
  const offers: OfferSnapshot[] = ctx.offers.map((o) => ({
    id: o.id,
    applicationId: o.application_id,
    status: o.status,
    updatedAt: o.updated_at,
    createdAt: o.created_at,
    expiresAt: o.expires_at,
    owningOrgId: o.owning_org_id,
  }));
  const placements: PlacementSnapshot[] = ctx.placements.map((p) => ({
    id: p.id,
    applicationId: p.application_id,
    offerId: p.offer_id,
    recruiterId: p.recruiter_id,
    status: p.status,
    fee: p.fee != null ? Number(p.fee) : null,
    createdAt: p.created_at,
    owningOrgId: p.owning_org_id,
  }));
  const interviews: InterviewSnapshot[] = ctx.interviews
    .filter((i) => i.application_id)
    .map((i) => ({
      id: i.id,
      applicationId: i.application_id as string,
      status: i.status,
      scheduledAt: i.scheduled_at,
    }));

  const appJobOrder = new Map(apps.map((a) => [a.id, a.jobOrderId]));
  const workload = computeActiveWorkload(apps, recruiterId, ctx.closedJobOrderIds);
  const reviewed = computeApplicationsReviewed(history, window, recruiterId);
  const ttfReview = computeTimeToFirstReview(
    apps,
    history,
    window,
    recruiterId,
    targets.maxTimeToFirstReviewHours,
  );
  const timeInStage = computeTimeInStage(history, window);
  const stalled = computeStalledByStage(apps, history, thresholds, nowIso, recruiterId);
  const tcs = computeTimeToClientSubmission(
    apps,
    history,
    window,
    targets.maxTimeToClientSubmissionDays,
    recruiterId,
  );
  const ttf = computeTimeToFill(
    placements,
    ctx.publishedByJob,
    window,
    targets.timeToFillDays,
    recruiterId,
    undefined,
    appJobOrder,
  );
  const cvConv = computeCvReviewConversion(history, window, recruiterId);
  const testPass = computeTestingPassRate(assessments, window);
  const interviewConv = computeInterviewConversion(
    history,
    window,
    recruiterId,
    targets.interviewConversionPct,
  );
  const csAccept = computeClientSubmissionAcceptance(
    submissions,
    window,
    targets.clientSubmissionAcceptancePct,
  );
  const offerHire = computeOfferToHire(offers, placements, window, targets.offerToHireRatioPct);
  const placeRate = computePlacementRate(
    history,
    placements,
    window,
    targets.placementRatePct,
    recruiterId,
  );
  const rejections = computeRejectionBreakdown(
    apps,
    window,
    REJECTION_REASONS.map((r) => ({ key: r.key, label: r.label.replace(" (note required)", "") })),
    recruiterId,
  );
  const withdrawal = computeWithdrawalRate(apps, window, recruiterId);

  const hiredAppIds = apps.filter((a) => a.currentStage === "hired").map((a) => a.id);
  const placementAppIds = new Set(placements.map((p) => p.applicationId));
  const invoicedAppIds = new Set(
    ctx.invoices
      .filter((i) => i.placement_id)
      .map((i) => {
        const p = placements.find((x) => x.id === i.placement_id);
        return p?.applicationId;
      })
      .filter(Boolean) as string[],
  );

  const sla = computeSlaQueue({
    awaitingFirstReview: ttfReview.awaitingFirstReview,
    assessments,
    interviews,
    stalledTotal: stalled.total,
    offers,
    hiredAppIds,
    placementAppIds,
    invoicedAppIds,
    nowIso,
  });

  const wlStatus = compareMaxCount(
    workload.total,
    targets.maxActiveWorkload,
    workload.total > 0 ? 1 : 0,
  );
  // empty workload is on_target (nothing overdue)
  const activeStatus: KpiStatus =
    workload.total === 0 ? "on_target" : wlStatus === "insufficient_data" ? "on_target" : wlStatus;

  return {
    applicationsReviewed: reviewed,
    activeWorkload: {
      total: workload.total,
      byStage: workload.byStage,
      status: activeStatus,
    },
    timeToFirstReview: {
      ...ttfReview,
      display: formatDurationHours(ttfReview.value),
    },
    timeInStage: timeInStage.byStage,
    timeToClientSubmission: {
      ...tcs,
      display:
        tcs.value == null
          ? "—"
          : tcs.value < 2
            ? formatDurationHours(tcs.value * 24)
            : `${tcs.value}d`,
    },
    timeToFill: {
      ...ttf,
      display: ttf.value == null ? "—" : `${ttf.value}d`,
    },
    cvReviewConversion: cvConv,
    testingPassRate: testPass,
    interviewConversion: interviewConv,
    clientSubmissionAcceptance: csAccept,
    offerToHire: offerHire,
    placementRate: placeRate,
    rejections,
    withdrawalRate: withdrawal,
    sla,
    funnel: funnelCounts(history, apps),
    targets,
    period,
    window,
  };
}

export async function getRecruiterKPIs(
  recruiterId: string,
  dateRange: KpiDateRange = "30d",
  scope: KpiScope = {},
  recruiterLevel: RecruiterLevel = "recruiter",
  orgId?: string,
  customWindow?: { since: string; until: string },
): Promise<RecruiterKPIs> {
  const period = periodFromLegacy(dateRange);
  const window = periodToWindow(period, new Date(), customWindow);
  const key = `kpis:${recruiterId}:${period}:${scope.jobRoleId ?? ""}:${scope.employerOrgId ?? ""}:${orgId ?? ""}`;
  const cached = cacheGet<RecruiterKPIs>(key);
  if (cached) return cached;

  const [targets, thresholds, ctx] = await Promise.all([
    getKPITargets(recruiterLevel, orgId),
    loadStageThresholds(orgId),
    loadRecruiterContext(recruiterId, window, scope),
  ]);

  const result = buildKpisFromContext(
    recruiterId,
    ctx,
    targets,
    thresholds,
    period,
    window,
    new Date().toISOString(),
  );
  return cacheSet(key, result);
}

/** @deprecated Removed fabricated quality score — returns zeros for UI compatibility. */
export async function getCandidateQualityScore(): Promise<CandidateQualityScore> {
  return {
    averageAptitudeScore: 0,
    interviewPerformance: 0,
    engagementScore: 0,
    overallScore: 0,
  };
}

export async function getPlacementFunnel(
  recruiterId: string,
  dateRange: KpiDateRange = "30d",
  scope: KpiScope = {},
): Promise<FunnelCounts> {
  const kpis = await getRecruiterKPIs(recruiterId, dateRange, scope);
  const f = kpis.funnel;
  return {
    applied: f.applied ?? 0,
    shortlisted: f.testing ?? 0,
    interviewed: f.interview_review ?? 0,
    hired: f.hired ?? 0,
    clientSubmission: f.client_submission,
    offer: f.offer,
    byStage: f,
  };
}

export async function getTimeToFillTrend(
  recruiterId: string,
  scope: KpiScope = {},
): Promise<TimeToFillTrendPoint[]> {
  const window = periodToWindow("90d");
  const ctx = await loadRecruiterContext(recruiterId, window, scope);
  const byWeek = new Map<string, number[]>();
  const appJob = new Map(ctx.apps.map((a) => [a.id, a.job_order_id]));
  const published = new Map(
    ctx.publishedByJob.filter((j) => j.publishedAt).map((j) => [j.jobOrderId, j.publishedAt!]),
  );
  for (const p of ctx.placements) {
    if (p.recruiter_id && p.recruiter_id !== recruiterId) continue;
    if (p.status === "failed") continue;
    const jo = appJob.get(p.application_id);
    const pub = jo ? published.get(jo) : undefined;
    if (!pub) continue;
    const week = weekStartIso(new Date(p.created_at));
    const days = (new Date(p.created_at).getTime() - new Date(pub).getTime()) / 86_400_000;
    const list = byWeek.get(week) ?? [];
    list.push(days);
    byWeek.set(week, list);
  }
  return buildWeeklyPoints(byWeek);
}

export async function getAppsReviewedTrend(
  recruiterId: string,
  scope: KpiScope = {},
): Promise<AppsReviewedTrendPoint[]> {
  const window = periodToWindow("90d");
  const ctx = await loadRecruiterContext(recruiterId, window, scope);
  const byWeek = new Map<string, Set<string>>();
  for (const h of ctx.history) {
    if (h.actor_id !== recruiterId) continue;
    const week = weekStartIso(new Date(h.created_at));
    const set = byWeek.get(week) ?? new Set();
    set.add(h.application_id);
    byWeek.set(week, set);
  }
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7 * 7);
  const points: AppsReviewedTrendPoint[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const week = weekStartIso(d);
    points.push({
      weekStart: week,
      weekLabel: new Date(week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      count: byWeek.get(week)?.size ?? 0,
    });
  }
  return points;
}

function weekStartIso(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const diff = (day + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  return x.toISOString().slice(0, 10);
}

function buildWeeklyPoints(byWeek: Map<string, number[]>): TimeToFillTrendPoint[] {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7 * 7);
  const points: TimeToFillTrendPoint[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const week = weekStartIso(d);
    const vals = byWeek.get(week) ?? [];
    const med =
      vals.length === 0
        ? null
        : [...vals].sort((a, b) => a - b)[Math.floor((vals.length - 1) / 2)]!;
    points.push({
      weekStart: week,
      weekLabel: new Date(week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      avgDays: med == null ? null : Math.round(med * 10) / 10,
      hiredCount: vals.length,
    });
  }
  return points;
}

function overallTargetStatus(kpis: RecruiterKPIs): KpiStatus {
  const statuses = [
    kpis.timeToFirstReview.status,
    kpis.placementRate.status,
    kpis.interviewConversion.status,
    kpis.clientSubmissionAcceptance.status,
    kpis.activeWorkload.status,
  ];
  if (statuses.includes("off_target")) return "off_target";
  if (statuses.includes("at_risk")) return "at_risk";
  if (statuses.every((s) => s === "insufficient_data")) return "insufficient_data";
  return "on_target";
}

export async function getRecruiterComparisonRow(
  recruiterId: string,
  meta: {
    name: string;
    email: string;
    level: RecruiterLevel;
    regionCode: string | null;
    organizationId: string | null;
    organizationName: string | null;
  },
  period: KpiPeriod = "30d",
): Promise<RecruiterComparisonRow> {
  const supabase = createClient();
  const kpis = await getRecruiterKPIs(
    recruiterId,
    period,
    { organizationId: meta.organizationId ?? undefined },
    meta.level,
    meta.organizationId ?? undefined,
  );
  const { count: assignedJobs } = await supabase
    .from("job_assignments")
    .select("id", { count: "exact", head: true })
    .eq("recruiter_user_id", recruiterId);

  const slaOverdue =
    kpis.sla.awaitingFirstReview +
    kpis.sla.assessmentsPastDeadline +
    kpis.sla.interviewsOverdue +
    kpis.sla.stalledInStage +
    kpis.sla.offersAwaitingResponse +
    kpis.sla.hiresAwaitingPlacementOrInvoice;

  return {
    recruiterId,
    name: meta.name,
    email: meta.email,
    level: meta.level,
    regionCode: meta.regionCode,
    organizationId: meta.organizationId,
    organizationName: meta.organizationName,
    assignedJobs: assignedJobs ?? 0,
    activeWorkload: kpis.activeWorkload.total,
    applicationsReviewed: kpis.applicationsReviewed.numerator,
    awaitingFirstReview: kpis.timeToFirstReview.awaitingFirstReview,
    medianFirstReviewHours: kpis.timeToFirstReview.value,
    clientSubmissions: kpis.funnel.client_submission ?? 0,
    placements: kpis.placementRate.numerator,
    placementRate: kpis.placementRate.value,
    slaOverdue,
    targetStatus: overallTargetStatus(kpis),
  };
}

export async function getFranchiseKpiDashboard(
  organizationId: string,
  period: KpiPeriod = "30d",
  countryCode?: string,
): Promise<FranchiseKpiDashboard> {
  const supabase = createClient();
  const window = periodToWindow(period);

  const [
    { count: activeJobs },
    { data: apps },
    { data: placements },
    { data: invoices },
    { data: recruitersMem, error: recruitersMemErr },
  ] = await Promise.all([
    supabase
      .from("job_orders")
      .select("id", { count: "exact", head: true })
      .eq("responsible_org_id", organizationId)
      .in("status", ["active", "approved", "on_hold"]),
    supabase.from("applications").select("*").eq("owning_org_id", organizationId),
    supabase.from("placements").select("*").eq("owning_org_id", organizationId),
    supabase.from("invoices").select("*").eq("owning_org_id", organizationId),
    supabase
      .from("memberships")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("role", "recruiter")
      .eq("status", "active"),
  ]);

  if (recruitersMemErr) {
    console.error("[getFranchiseKpiDashboard memberships]", recruitersMemErr.message);
  }

  let appRows = (apps as ApplicationRow[] | null) ?? [];
  if (countryCode) {
    const jobIds = [...new Set(appRows.map((a) => a.job_order_id))];
    if (jobIds.length) {
      const { data: jobs } = await supabase
        .from("job_orders")
        .select("id,country_code")
        .in("id", jobIds);
      const allowed = new Set(
        ((jobs as { id: string; country_code: string | null }[] | null) ?? [])
          .filter((j) => j.country_code === countryCode)
          .map((j) => j.id),
      );
      appRows = appRows.filter((a) => allowed.has(a.job_order_id));
    }
  }

  const activeApplications = appRows.filter(
    (a) => !a.withdrawn_at && !["rejected", "hired", "closed"].includes(a.current_stage),
  ).length;

  const placeRows = (placements as PlacementRow[] | null) ?? [];
  const currentPlacements = placeRows.filter((p) =>
    ["active", "guarantee_period"].includes(p.status),
  ).length;
  const fees = placeRows
    .filter((p) => p.status !== "failed" && p.fee != null)
    .map((p) => Number(p.fee));
  const placementValue = fees.length ? fees.reduce((a, b) => a + b, 0) : null;

  const invRows = (invoices as InvoiceRow[] | null) ?? [];
  const openInvoices = invRows.filter((i) =>
    ["issued", "partially_paid", "overdue"].includes(i.status),
  ).length;
  const paidInvoiceTotal = invRows
    .filter((i) => i.payment_status === "paid")
    .reduce((s, i) => s + Number(i.total ?? 0), 0);
  const unpaidInvoiceTotal = invRows
    .filter((i) => i.payment_status !== "paid" && i.status !== "voided")
    .reduce((s, i) => s + Number(i.total ?? 0), 0);

  const mems = (recruitersMem as MembershipRow[] | null) ?? [];
  const userIds = mems.map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id,full_name,email").in("id", userIds)
    : { data: [] };
  const profileById = new Map(
    ((profiles as Pick<ProfileRow, "id" | "full_name" | "email">[] | null) ?? []).map((p) => [
      p.id,
      p,
    ]),
  );

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const orgName = (org as { name: string } | null)?.name ?? null;

  const recruiterRows: RecruiterComparisonRow[] = [];
  for (const m of mems) {
    const p = profileById.get(m.user_id);
    recruiterRows.push(
      await getRecruiterComparisonRow(
        m.user_id,
        {
          name: p?.full_name ?? "Recruiter",
          email: p?.email ?? "",
          level: normalizeRecruiterLevel(m.recruiter_level),
          regionCode: m.country_code,
          organizationId,
          organizationName: orgName,
        },
        period,
      ),
    );
  }
  recruiterRows.sort((a, b) => b.slaOverdue - a.slaOverdue);

  // Franchise-level aggregates from first recruiter contexts is expensive;
  // compute from org apps + shared history.
  const appIds = appRows.map((a) => a.id);
  let history: ApplicationStageHistoryRow[] = [];
  let submissions: EmployerSubmissionRow[] = [];
  if (appIds.length) {
    const [{ data: h }, { data: s }] = await Promise.all([
      supabase.from("application_stage_history").select("*").in("application_id", appIds),
      supabase.from("employer_submissions").select("*").in("application_id", appIds),
    ]);
    history = (h as ApplicationStageHistoryRow[] | null) ?? [];
    submissions = (s as EmployerSubmissionRow[] | null) ?? [];
  }

  const histSnap = history.map(toHistSnap);
  const appSnap = appRows.map(toAppSnap);
  const funnel = funnelCounts(histSnap, appSnap);

  const firstReviewHours: number[] = [];
  const first = firstReviewByApp(histSnap);
  for (const a of appSnap) {
    const ev = first.get(a.id);
    if (!ev) continue;
    if (ev.createdAt < window.since || ev.createdAt >= window.until) continue;
    firstReviewHours.push(hoursBetween(a.createdAt, ev.createdAt));
  }

  const tcs = computeTimeToClientSubmission(appSnap, histSnap, window, 14);
  const placeRate = computePlacementRate(
    histSnap,
    placeRows.map((p) => ({
      id: p.id,
      applicationId: p.application_id,
      offerId: p.offer_id,
      recruiterId: p.recruiter_id,
      status: p.status,
      fee: p.fee != null ? Number(p.fee) : null,
      createdAt: p.created_at,
      owningOrgId: p.owning_org_id,
    })),
    window,
    70,
  );
  const csAccept = computeClientSubmissionAcceptance(
    submissions.map((s) => ({
      id: s.id,
      applicationId: s.application_id,
      status: s.status,
      submittedAt: s.submitted_at,
      updatedAt: s.updated_at,
      submittingOrgId: s.submitting_org_id,
    })),
    window,
    40,
  );

  const thresholds = await loadStageThresholds(organizationId);
  const stalled = computeStalledByStage(appSnap, histSnap, thresholds, new Date().toISOString());

  const rejectionTotal = appSnap.filter(
    (a) => a.rejectedAt && a.rejectedAt >= window.since && a.rejectedAt < window.until,
  ).length;
  const withdrawalTotal = appSnap.filter(
    (a) => a.withdrawnAt && a.withdrawnAt >= window.since && a.withdrawnAt < window.until,
  ).length;

  // Time to fill from org placements + published jobs
  const appJobOrder = new Map(appSnap.map((a) => [a.id, a.jobOrderId]));
  const jobIds = [...new Set(appSnap.map((a) => a.jobOrderId))];
  let publishedByJob: JobPublishSnapshot[] = [];
  if (jobIds.length) {
    const { data: jobsPub } = await supabase
      .from("jobs")
      .select("job_order_id,published_at,status")
      .in("job_order_id", jobIds);
    publishedByJob = (
      (jobsPub as { job_order_id: string; published_at: string | null; status: string }[] | null) ??
      []
    ).map((j) => ({
      jobOrderId: j.job_order_id,
      publishedAt: j.published_at,
      jobStatus: j.status,
    }));
  }
  const ttf = computeTimeToFill(
    placeRows.map((p) => ({
      id: p.id,
      applicationId: p.application_id,
      offerId: p.offer_id,
      recruiterId: p.recruiter_id,
      status: p.status,
      fee: p.fee != null ? Number(p.fee) : null,
      createdAt: p.created_at,
      owningOrgId: p.owning_org_id,
    })),
    publishedByJob,
    window,
    14,
    undefined,
    undefined,
    appJobOrder,
  );

  return {
    activeJobs: activeJobs ?? 0,
    activeApplications,
    currentPlacements,
    placementValue,
    openInvoices,
    paidInvoiceTotal,
    unpaidInvoiceTotal,
    recruiterHeadcount: mems.length,
    funnel,
    medianTimeToFirstReviewHours:
      median(firstReviewHours) == null ? null : Math.round(median(firstReviewHours)! * 10) / 10,
    medianTimeToClientSubmissionDays: tcs.value,
    medianTimeToFillDays: ttf.value,
    placementRate: placeRate,
    clientSubmissionAcceptance: csAccept,
    rejectionTotal,
    withdrawalTotal,
    stalledByStage: stalled.byStage,
    recruiters: recruiterRows,
  };
}

export async function getHqFranchiseComparison(
  filters: { countryCode?: string; organizationId?: string } = {},
  period: KpiPeriod = "30d",
): Promise<FranchiseComparisonRow[]> {
  const supabase = createClient();
  let q = supabase
    .from("organizations")
    .select("id,name,country_code")
    .eq("org_type", "franchise")
    .eq("status", "active");
  if (filters.countryCode) q = q.eq("country_code", filters.countryCode);
  if (filters.organizationId) q = q.eq("id", filters.organizationId);
  const { data: orgs, error } = await q;
  if (error) {
    console.error("[getHqFranchiseComparison]", error.message);
    return [];
  }
  const rows: FranchiseComparisonRow[] = [];
  for (const o of (orgs as { id: string; name: string; country_code: string | null }[] | null) ??
    []) {
    const dash = await getFranchiseKpiDashboard(o.id, period, filters.countryCode);
    rows.push({
      organizationId: o.id,
      organizationName: o.name,
      countryCode: o.country_code,
      recruiterHeadcount: dash.recruiterHeadcount,
      activeJobs: dash.activeJobs,
      activeApplications: dash.activeApplications,
      placements: dash.currentPlacements,
      placementRate: dash.placementRate.value,
      medianTimeToFillDays: dash.medianTimeToFillDays,
      openInvoices: dash.openInvoices,
      slaOverdue: dash.recruiters.reduce((s, r) => s + r.slaOverdue, 0),
    });
  }
  rows.sort((a, b) => b.slaOverdue - a.slaOverdue);
  return rows;
}

export async function getRecruitersWithRoles(filters: {
  organizationId?: string;
  regionCode?: string;
  level?: string;
}): Promise<RecruiterWithRoles[]> {
  const key = `recruiters:${filters.organizationId ?? ""}:${filters.regionCode ?? ""}:${filters.level ?? ""}`;
  const cached = cacheGet<RecruiterWithRoles[]>(key);
  if (cached) return cached;

  const supabase = createClient();
  let memQuery = supabase
    .from("memberships")
    .select("*")
    .eq("role", "recruiter")
    .eq("status", "active");

  if (filters.organizationId) memQuery = memQuery.eq("organization_id", filters.organizationId);
  if (filters.regionCode) memQuery = memQuery.eq("country_code", filters.regionCode);
  if (filters.level) {
    memQuery = memQuery.eq(
      "recruiter_level",
      normalizeRecruiterLevel(filters.level) as RecruiterLevel,
    );
  }

  const { data: memberships, error } = await memQuery;
  if (error) {
    console.error("[getRecruitersWithRoles]", error.message);
    return [];
  }

  const mems = (memberships as MembershipRow[] | null) ?? [];
  if (mems.length === 0) return cacheSet(key, []);

  const userIds = [...new Set(mems.map((m) => m.user_id))];
  const [{ data: profiles }, { data: assignments }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email").in("id", userIds),
    supabase
      .from("recruiter_role_assignments")
      .select("recruiter_id,job_role_id,status")
      .in("recruiter_id", userIds)
      .eq("status", "active"),
  ]);

  const profileById = new Map(
    ((profiles as Pick<ProfileRow, "id" | "full_name" | "email">[] | null) ?? []).map((p) => [
      p.id,
      p,
    ]),
  );
  const rolesByRecruiter = new Map<string, string[]>();
  for (const a of (assignments as { recruiter_id: string; job_role_id: string }[] | null) ?? []) {
    const list = rolesByRecruiter.get(a.recruiter_id) ?? [];
    list.push(a.job_role_id);
    rolesByRecruiter.set(a.recruiter_id, list);
  }

  const results: RecruiterWithRoles[] = [];
  for (const m of mems) {
    const profile = profileById.get(m.user_id);
    const level = normalizeRecruiterLevel(m.recruiter_level);
    let kpisSummary = {
      timeToFill: null as number | null,
      placementRate: null as number | null,
      applicationsReviewedPerWeek: 0,
      offerToHireRatio: null as number | null,
    };
    try {
      const kpis = await getRecruiterKPIs(
        m.user_id,
        "30d",
        {},
        level,
        m.organization_id ?? undefined,
      );
      kpisSummary = {
        timeToFill: kpis.timeToFill.value,
        placementRate: kpis.placementRate.value,
        applicationsReviewedPerWeek: kpis.applicationsReviewed.numerator,
        offerToHireRatio: kpis.offerToHire.value,
      };
    } catch (e) {
      console.error("[getRecruitersWithRoles kpi]", e);
    }

    results.push({
      recruiterId: m.user_id,
      name: profile?.full_name ?? "Recruiter",
      email: profile?.email ?? "",
      level,
      regionCode: m.country_code,
      organizationId: m.organization_id,
      assignedRoles: rolesByRecruiter.get(m.user_id) ?? [],
      kpisSummary,
    });
  }

  return cacheSet(key, results);
}

export async function getRecruiterCompanies(recruiterId: string): Promise<KpiCompany[]> {
  const key = `companies:${recruiterId}`;
  const cached = cacheGet<KpiCompany[]>(key);
  if (cached) return cached;

  const window = periodToWindow("90d");
  const ctx = await loadRecruiterContext(recruiterId, window, {});
  const counts = new Map<string, number>();
  for (const app of ctx.apps) {
    if (app.withdrawn_at) continue;
    const orgId = ctx.jobsById.get(app.job_order_id)?.employer_org_id;
    if (!orgId) continue;
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
  }

  const orgIds = [...counts.keys()];
  if (orgIds.length === 0) return cacheSet(key, []);

  const supabase = createClient();
  const { data: orgs } = await supabase.from("organizations").select("id,name").in("id", orgIds);
  const companies: KpiCompany[] = ((orgs as { id: string; name: string }[] | null) ?? [])
    .map((o) => ({
      id: o.id,
      name: o.name,
      applicationCount: counts.get(o.id) ?? 0,
    }))
    .sort((a, b) => b.applicationCount - a.applicationCount || a.name.localeCompare(b.name));

  return cacheSet(key, companies);
}

export async function getMyRecruiterMeta(userId: string): Promise<{
  level: RecruiterLevel;
  organizationId: string | null;
  regionCode: string | null;
  name: string;
}> {
  const supabase = createClient();
  const [{ data: mem }, { data: profile }] = await Promise.all([
    supabase
      .from("memberships")
      .select("*")
      .eq("user_id", userId)
      .eq("role", "recruiter")
      .eq("status", "active")
      .maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  const m = mem as MembershipRow | null;
  return {
    level: normalizeRecruiterLevel(m?.recruiter_level),
    organizationId: m?.organization_id ?? null,
    regionCode: m?.country_code ?? null,
    name: (profile as { full_name: string | null } | null)?.full_name ?? "Recruiter",
  };
}

export async function getRecruiterProfile(recruiterId: string): Promise<{
  id: string;
  name: string;
  email: string;
  level: RecruiterLevel;
  regionCode: string | null;
  organizationId: string | null;
  organizationName: string | null;
} | null> {
  const supabase = createClient();
  const [{ data: profile }, { data: mem }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email").eq("id", recruiterId).maybeSingle(),
    supabase
      .from("memberships")
      .select("*")
      .eq("user_id", recruiterId)
      .eq("role", "recruiter")
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (!profile) return null;
  const p = profile as Pick<ProfileRow, "id" | "full_name" | "email">;
  const m = mem as MembershipRow | null;
  let organizationName: string | null = null;
  if (m?.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", m.organization_id)
      .maybeSingle();
    organizationName = (org as { name: string } | null)?.name ?? null;
  }
  return {
    id: p.id,
    name: p.full_name ?? "Recruiter",
    email: p.email,
    level: normalizeRecruiterLevel(m?.recruiter_level),
    regionCode: m?.country_code ?? null,
    organizationId: m?.organization_id ?? null,
    organizationName,
  };
}

export async function getRecruiterAssignedRoles(recruiterId: string): Promise<AssignedRole[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("recruiter_role_assignments")
    .select("*")
    .eq("recruiter_id", recruiterId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getRecruiterAssignedRoles]", error.message);
    return [];
  }

  const rows = (data as RecruiterRoleAssignmentRow[] | null) ?? [];
  if (rows.length === 0) return [];

  const roleIds = [...new Set(rows.map((r) => r.job_role_id))];
  const { data: roles } = await supabase.from("job_roles").select("*").in("id", roleIds);
  const labelById = new Map(
    ((roles as JobRoleRow[] | null) ?? []).map((r) => [r.id, r.label] as const),
  );

  return rows.map((r) => ({
    roleId: r.job_role_id,
    roleName: labelById.get(r.job_role_id) ?? r.job_role_id,
    region: r.assigned_region_code,
    status: r.status,
    assignedAt: r.created_at,
  }));
}

export async function listJobRoles(): Promise<JobRoleRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("job_roles")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[listJobRoles]", error.message);
    return [];
  }
  return (data as JobRoleRow[] | null) ?? [];
}

export async function assignRoleToRecruiter(params: {
  recruiterId: string;
  jobRoleId: string;
  assignedBy: string;
  regionCode: string;
  organizationId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("recruiter_role_assignments").upsert(
    {
      recruiter_id: params.recruiterId,
      job_role_id: params.jobRoleId,
      assigned_by: params.assignedBy,
      assigned_region_code: params.regionCode,
      recruiter_organization_id: params.organizationId ?? null,
      status: "active",
    },
    { onConflict: "recruiter_id,job_role_id" },
  );
  clearRecruiterKpiCache();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function revokeRoleFromRecruiter(params: {
  recruiterId: string;
  jobRoleId: string;
  revokedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("recruiter_role_assignments")
    .update({ status: "inactive", assigned_by: params.revokedBy })
    .eq("recruiter_id", params.recruiterId)
    .eq("job_role_id", params.jobRoleId);
  clearRecruiterKpiCache();
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { RECRUITER_LEVELS, formatDurationHours };
