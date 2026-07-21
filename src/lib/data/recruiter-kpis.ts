import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationRow,
  ApplicationStageHistoryRow,
  InterviewReviewRow,
  JobOrderRow,
  JobRoleRow,
  MembershipRow,
  ProfileRow,
  RecruiterKpiTargetRow,
  RecruiterRoleAssignmentRow,
} from "@/lib/database.types";
import type { RecruiterLevel } from "@/lib/rbac";

export type KpiDateRange = "week" | "month" | "quarter";
export type KpiStatus = "on_track" | "at_risk" | "exceeded";

/** Scope KPIs by assigned role and/or employer company. */
export type KpiScope = {
  jobRoleId?: string;
  employerOrgId?: string;
};

export interface KpiCompany {
  id: string;
  name: string;
  /** Active applications in the default lookback (helps pick high-volume companies). */
  applicationCount: number;
}
export interface KpiTargets {
  timeToFillDays: number;
  placementRatePct: number;
  appsReviewedPerWeek: number;
  offerToHireRatioPct: number;
  minAptitudeTestScore: number;
}

export interface CandidateQualityScore {
  averageAptitudeScore: number;
  interviewPerformance: number;
  engagementScore: number;
  overallScore: number;
}

export interface RecruiterKPIs {
  timeToFill: number;
  placementRate: number;
  candidateQualityScore: number;
  applicationsReviewedPerWeek: number;
  offerToHireRatio: number;
  comparedToTarget: {
    timeToFill: KpiStatus;
    placementRate: KpiStatus;
    candidateQuality: KpiStatus;
    applicationsReviewedPerWeek: KpiStatus;
    offerToHireRatio: KpiStatus;
  };
  targets: KpiTargets;
  sampleSizes: {
    hired: number;
    applied: number;
    offers: number;
    acceptedOffers: number;
    reviewed: number;
  };
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

export interface RecruiterWithRoles {
  recruiterId: string;
  name: string;
  email: string;
  level: RecruiterLevel;
  regionCode: string | null;
  organizationId: string | null;
  assignedRoles: string[];
  kpisSummary: {
    timeToFill: number;
    placementRate: number;
    applicationsReviewedPerWeek: number;
    offerToHireRatio: number;
  };
}

// ---- small cache (5 min, process-local) ------------------------------------
type CacheEntry<T> = { expires: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T): T {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export function clearRecruiterKpiCache(): void {
  cache.clear();
}

function rangeDays(range: KpiDateRange): number {
  if (range === "week") return 7;
  if (range === "quarter") return 90;
  return 30;
}

function sinceIso(range: KpiDateRange): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - rangeDays(range));
  return d.toISOString();
}

function weekStartIso(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday-start
  x.setUTCDate(x.getUTCDate() + diff);
  return x.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, ms / 86_400_000);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Lower-is-better metrics (time to fill). */
function compareLowerIsBetter(actual: number, target: number, sampleSize: number): KpiStatus {
  if (sampleSize === 0) return "at_risk";
  if (actual <= target) return actual <= target * 0.85 ? "exceeded" : "on_track";
  if (actual <= target * 1.25) return "at_risk";
  return "at_risk";
}

/** Higher-is-better metrics. */
function compareHigherIsBetter(actual: number, target: number, sampleSize: number): KpiStatus {
  if (sampleSize === 0) return "at_risk";
  if (actual >= target) return actual >= target * 1.1 ? "exceeded" : "on_track";
  if (actual >= target * 0.7) return "at_risk";
  return "at_risk";
}

type JobSnap = Pick<JobOrderRow, "id" | "title" | "job_role" | "employer_org_id">;

type AppCtx = {
  apps: ApplicationRow[];
  jobsById: Map<string, JobSnap>;
  history: ApplicationStageHistoryRow[];
  reviews: InterviewReviewRow[];
};

async function loadRecruiterAppContext(
  recruiterId: string,
  since: string,
  scope: KpiScope = {},
): Promise<AppCtx> {
  const supabase = createClient();
  const { jobRoleId, employerOrgId } = scope;

  const { data: assignedApps, error: appsErr } = await supabase
    .from("applications")
    .select("*")
    .eq("assigned_recruiter_id", recruiterId)
    .gte("created_at", since);

  if (appsErr) console.error("[loadRecruiterAppContext apps]", appsErr.message);

  let apps = (assignedApps as ApplicationRow[] | null) ?? [];

  // Expand with apps on jobs matching the recruiter's active role assignments.
  // Never query all job_orders — only when we have a role list (and optional company).
  {
    const { data: roleRows } = await supabase
      .from("recruiter_role_assignments")
      .select("job_role_id")
      .eq("recruiter_id", recruiterId)
      .eq("status", "active");
    const roleIds = ((roleRows as { job_role_id: string }[] | null) ?? []).map((r) => r.job_role_id);
    const filterRoles = jobRoleId ? [jobRoleId] : roleIds;

    if (filterRoles.length > 0) {
      let jobsQuery = supabase
        .from("job_orders")
        .select("id,title,job_role,employer_org_id")
        .in("job_role", filterRoles);
      if (employerOrgId) jobsQuery = jobsQuery.eq("employer_org_id", employerOrgId);

      const { data: scopedJobs } = await jobsQuery;
      const jobIds = ((scopedJobs as JobSnap[] | null) ?? []).map((j) => j.id);
      if (jobIds.length > 0) {
        const { data: roleApps } = await supabase
          .from("applications")
          .select("*")
          .in("job_order_id", jobIds)
          .gte("created_at", since);
        const byId = new Map(apps.map((a) => [a.id, a]));
        for (const a of (roleApps as ApplicationRow[] | null) ?? []) {
          if (a.assigned_recruiter_id === recruiterId || a.assigned_recruiter_id === null) {
            byId.set(a.id, a);
          }
        }
        apps = [...byId.values()];
      } else if (jobRoleId || employerOrgId) {
        apps = [];
      }
    } else if (jobRoleId) {
      // Explicit role requested but recruiter has no matching assignments
      apps = [];
    }
  }

  // Also pull apps from job_assignments for this recruiter (company filter applies later)
  {
    const { data: ja } = await supabase
      .from("job_assignments")
      .select("job_order_id")
      .eq("recruiter_user_id", recruiterId);
    const assignedJobIds = ((ja as { job_order_id: string }[] | null) ?? []).map(
      (r) => r.job_order_id,
    );
    if (assignedJobIds.length > 0) {
      const { data: jaApps } = await supabase
        .from("applications")
        .select("*")
        .in("job_order_id", assignedJobIds)
        .gte("created_at", since);
      const byId = new Map(apps.map((a) => [a.id, a]));
      for (const a of (jaApps as ApplicationRow[] | null) ?? []) {
        byId.set(a.id, a);
      }
      apps = [...byId.values()];
    }
  }

  // Hydrate jobs, then apply role + company filters on the assigned-app path too
  const jobOrderIds = [...new Set(apps.map((a) => a.job_order_id))];
  let jobsById = new Map<string, JobSnap>();
  if (jobOrderIds.length > 0) {
    const { data: jobs } = await supabase
      .from("job_orders")
      .select("id,title,job_role,employer_org_id")
      .in("id", jobOrderIds);
    jobsById = new Map(((jobs as JobSnap[] | null) ?? []).map((j) => [j.id, j]));
  }

  if (jobRoleId) {
    apps = apps.filter((a) => jobsById.get(a.job_order_id)?.job_role === jobRoleId);
  }
  if (employerOrgId) {
    apps = apps.filter((a) => jobsById.get(a.job_order_id)?.employer_org_id === employerOrgId);
  }

  // Drop jobs that no longer have apps after filtering
  const keptJobIds = new Set(apps.map((a) => a.job_order_id));
  for (const id of [...jobsById.keys()]) {
    if (!keptJobIds.has(id)) jobsById.delete(id);
  }

  const appIds = apps.map((a) => a.id);

  const [{ data: history }] = await Promise.all([
    appIds.length
      ? supabase
          .from("application_stage_history")
          .select("*")
          .in("application_id", appIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  let reviewRows: InterviewReviewRow[] = [];
  if (appIds.length > 0) {
    const { data: assignments } = await supabase
      .from("interview_assignments")
      .select("id,application_id")
      .in("application_id", appIds);
    const assignmentIds = (
      (assignments as { id: string; application_id: string }[] | null) ?? []
    ).map((a) => a.id);
    if (assignmentIds.length > 0) {
      const { data: byAssignment } = await supabase
        .from("interview_reviews")
        .select("*")
        .in("assignment_id", assignmentIds);
      reviewRows = (byAssignment as InterviewReviewRow[] | null) ?? [];
    }
  }

  return {
    apps,
    jobsById,
    history: (history as ApplicationStageHistoryRow[] | null) ?? [],
    reviews: reviewRows,
  };
}

function hiredAtMap(history: ApplicationStageHistoryRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of history) {
    if (h.to_stage === "hired" && !map.has(h.application_id)) {
      map.set(h.application_id, h.created_at);
    }
  }
  return map;
}

function firstReachedMap(
  history: ApplicationStageHistoryRow[],
  stages: string[],
): Set<string> {
  const set = new Set<string>();
  const stageSet = new Set(stages);
  for (const h of history) {
    if (stageSet.has(h.to_stage)) set.add(h.application_id);
  }
  return set;
}

// ---- Public API -------------------------------------------------------------

export async function getKPITargets(
  recruiterLevel: RecruiterLevel,
  orgId?: string,
): Promise<KpiTargets> {
  const key = `targets:${recruiterLevel}:${orgId ?? "global"}`;
  const cached = cacheGet<KpiTargets>(key);
  if (cached) return cached;

  const supabase = createClient();
  const defaults: KpiTargets = {
    timeToFillDays: recruiterLevel === "head" ? 10 : recruiterLevel === "junior" ? 21 : 14,
    placementRatePct: recruiterLevel === "head" ? 80 : recruiterLevel === "junior" ? 50 : 70,
    appsReviewedPerWeek: recruiterLevel === "head" ? 30 : recruiterLevel === "junior" ? 12 : 20,
    offerToHireRatioPct: recruiterLevel === "head" ? 60 : recruiterLevel === "junior" ? 40 : 50,
    minAptitudeTestScore: recruiterLevel === "head" ? 70 : recruiterLevel === "junior" ? 50 : 60,
  };

  if (orgId) {
    const { data: orgRow } = await supabase
      .from("recruiter_kpi_targets")
      .select("*")
      .eq("recruiter_level", recruiterLevel)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (orgRow) {
      const r = orgRow as RecruiterKpiTargetRow;
      return cacheSet(key, {
        timeToFillDays: r.target_time_to_fill_days,
        placementRatePct: r.target_placement_rate_pct,
        appsReviewedPerWeek: r.target_apps_reviewed_per_week,
        offerToHireRatioPct: r.target_offer_to_hire_ratio_pct,
        minAptitudeTestScore: r.min_aptitude_test_score ?? defaults.minAptitudeTestScore,
      });
    }
  }

  const { data: globalRow } = await supabase
    .from("recruiter_kpi_targets")
    .select("*")
    .eq("recruiter_level", recruiterLevel)
    .is("organization_id", null)
    .maybeSingle();

  if (globalRow) {
    const r = globalRow as RecruiterKpiTargetRow;
    return cacheSet(key, {
      timeToFillDays: r.target_time_to_fill_days,
      placementRatePct: r.target_placement_rate_pct,
      appsReviewedPerWeek: r.target_apps_reviewed_per_week,
      offerToHireRatioPct: r.target_offer_to_hire_ratio_pct,
      minAptitudeTestScore: r.min_aptitude_test_score ?? defaults.minAptitudeTestScore,
    });
  }

  return cacheSet(key, defaults);
}

export async function getTimeToFill(
  recruiterId: string,
  scope: KpiScope = {},
  dateRange: KpiDateRange = "month",
): Promise<number> {
  const ctx = await loadRecruiterAppContext(recruiterId, sinceIso(dateRange), scope);
  const hiredAt = hiredAtMap(ctx.history);
  const days: number[] = [];
  for (const app of ctx.apps) {
    const at = hiredAt.get(app.id);
    if (!at && app.current_stage !== "hired") continue;
    const end = at ?? app.updated_at;
    days.push(daysBetween(app.created_at, end));
  }
  return round1(avg(days));
}

export async function getPlacementRate(
  recruiterId: string,
  scope: KpiScope = {},
  dateRange: KpiDateRange = "month",
): Promise<number> {
  const ctx = await loadRecruiterAppContext(recruiterId, sinceIso(dateRange), scope);
  const applied = ctx.apps.filter((a) => !a.withdrawn_at).length;
  if (applied === 0) return 0;
  const hired = ctx.apps.filter((a) => !a.withdrawn_at && a.current_stage === "hired").length;
  return round1((hired / applied) * 100);
}

export async function getCandidateQualityScore(
  recruiterId: string,
  scope: KpiScope = {},
  dateRange: KpiDateRange = "month",
): Promise<CandidateQualityScore> {
  const since = sinceIso(dateRange);
  const ctx = await loadRecruiterAppContext(recruiterId, since, scope);
  const supabase = createClient();

  // Aptitude: no dedicated test_answers table yet — approximate from progression
  // through testing / interview stages (0–100).
  const progressed = firstReachedMap(ctx.history, [
    "testing",
    "test_review",
    "interview_screening",
    "interview_review",
    "hired",
  ]);
  const aptitudeScores = ctx.apps.map((a) => {
    if (a.current_stage === "hired") return 85;
    if (
      progressed.has(a.id) ||
      [
        "testing",
        "test_review",
        "interview_screening",
        "interview_review",
        "client_submission",
        "offer",
      ].includes(a.current_stage)
    )
      return 70;
    if (a.current_stage === "cv_review") return 55;
    return 40;
  });
  const averageAptitudeScore = round1(avg(aptitudeScores.length ? aptitudeScores : [0]));

  // Interview: overall_rating 1–5 → 0–100
  const interviewScores = ctx.reviews
    .filter((r) => r.overall_rating != null)
    .map((r) => ((r.overall_rating as number) / 5) * 100);
  const interviewPerformance = round1(avg(interviewScores.length ? interviewScores : [0]));

  // Engagement: activity_events involving this recruiter as actor in range
  const { data: events } = await supabase
    .from("activity_events")
    .select("id,created_at")
    .eq("actor_id", recruiterId)
    .gte("created_at", since);
  const eventCount = ((events as { id: string }[] | null) ?? []).length;
  // Scale: 0 events → 20, 10+ → 100
  const engagementScore = round1(Math.min(100, 20 + eventCount * 8));

  const overallScore = round1(
    averageAptitudeScore * 0.4 + interviewPerformance * 0.35 + engagementScore * 0.25,
  );

  return { averageAptitudeScore, interviewPerformance, engagementScore, overallScore };
}

export async function getApplicationsReviewedPerWeek(
  recruiterId: string,
  scope: KpiScope = {},
  dateRange: KpiDateRange = "month",
): Promise<number> {
  const since = sinceIso(dateRange);
  const ctx = await loadRecruiterAppContext(recruiterId, since, scope);
  const appIds = new Set(ctx.apps.map((a) => a.id));
  const reviewed = ctx.history.filter(
    (h) => h.actor_id === recruiterId && appIds.has(h.application_id) && h.created_at >= since,
  );
  const weeks = Math.max(1, rangeDays(dateRange) / 7);
  return round1(reviewed.length / weeks);
}

export async function getOfferToHireRatio(
  recruiterId: string,
  scope: KpiScope = {},
  dateRange: KpiDateRange = "month",
): Promise<number> {
  const ctx = await loadRecruiterAppContext(recruiterId, sinceIso(dateRange), scope);
  const reachedOffer = firstReachedMap(ctx.history, ["offer", "hired"]);
  // Also count current stage
  for (const a of ctx.apps) {
    if (a.current_stage === "offer" || a.current_stage === "hired") reachedOffer.add(a.id);
  }
  const offers = reachedOffer.size;
  if (offers === 0) return 0;
  const hired = ctx.apps.filter((a) => a.current_stage === "hired").length;
  return round1((hired / offers) * 100);
}

export async function getRecruiterKPIs(
  recruiterId: string,
  dateRange: KpiDateRange = "month",
  scope: KpiScope = {},
  recruiterLevel: RecruiterLevel = "generic",
  orgId?: string,
): Promise<RecruiterKPIs> {
  const key = `kpis:${recruiterId}:${dateRange}:${scope.jobRoleId ?? "all"}:${scope.employerOrgId ?? "all"}:${recruiterLevel}`;
  const cached = cacheGet<RecruiterKPIs>(key);
  if (cached) return cached;

  const [targets, timeToFill, placementRate, quality, appsReviewed, offerRatio, ctx] =
    await Promise.all([
      getKPITargets(recruiterLevel, orgId),
      getTimeToFill(recruiterId, scope, dateRange),
      getPlacementRate(recruiterId, scope, dateRange),
      getCandidateQualityScore(recruiterId, scope, dateRange),
      getApplicationsReviewedPerWeek(recruiterId, scope, dateRange),
      getOfferToHireRatio(recruiterId, scope, dateRange),
      loadRecruiterAppContext(recruiterId, sinceIso(dateRange), scope),
    ]);

  const applied = ctx.apps.filter((a) => !a.withdrawn_at).length;
  const hired = ctx.apps.filter((a) => !a.withdrawn_at && a.current_stage === "hired").length;
  const reachedOffer = firstReachedMap(ctx.history, ["offer", "hired"]);
  for (const a of ctx.apps) {
    if (a.current_stage === "offer" || a.current_stage === "hired") reachedOffer.add(a.id);
  }
  const reviewed = ctx.history.filter((h) => h.actor_id === recruiterId).length;

  const result: RecruiterKPIs = {
    timeToFill,
    placementRate,
    candidateQualityScore: quality.overallScore,
    applicationsReviewedPerWeek: appsReviewed,
    offerToHireRatio: offerRatio,
    comparedToTarget: {
      timeToFill: compareLowerIsBetter(timeToFill, targets.timeToFillDays, hired),
      placementRate: compareHigherIsBetter(placementRate, targets.placementRatePct, applied),
      candidateQuality: compareHigherIsBetter(
        quality.overallScore,
        targets.minAptitudeTestScore,
        applied,
      ),
      applicationsReviewedPerWeek: compareHigherIsBetter(
        appsReviewed,
        targets.appsReviewedPerWeek,
        reviewed,
      ),
      offerToHireRatio: compareHigherIsBetter(
        offerRatio,
        targets.offerToHireRatioPct,
        reachedOffer.size,
      ),
    },
    targets,
    sampleSizes: {
      hired,
      applied,
      offers: reachedOffer.size,
      acceptedOffers: hired,
      reviewed,
    },
  };

  return cacheSet(key, result);
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

export async function getPlacementFunnel(
  recruiterId: string,
  dateRange: KpiDateRange = "month",
  scope: KpiScope = {},
): Promise<FunnelCounts> {
  const ctx = await loadRecruiterAppContext(recruiterId, sinceIso(dateRange), scope);
  const active = ctx.apps.filter((a) => !a.withdrawn_at);
  const shortlisted = firstReachedMap(ctx.history, [
    "testing",
    "test_review",
    "interview_screening",
    "interview_review",
    "reference_checks",
    "client_submission",
    "offer",
    "hired",
  ]);
  const interviewed = firstReachedMap(ctx.history, [
    "interview_screening",
    "interview_review",
    "reference_checks",
    "client_submission",
    "offer",
    "hired",
  ]);
  for (const a of active) {
    if (
      [
        "testing",
        "test_review",
        "interview_screening",
        "interview_review",
        "reference_checks",
        "client_submission",
        "offer",
        "hired",
      ].includes(a.current_stage)
    )
      shortlisted.add(a.id);
    if (
      [
        "interview_screening",
        "interview_review",
        "reference_checks",
        "client_submission",
        "offer",
        "hired",
      ].includes(a.current_stage)
    )
      interviewed.add(a.id);
  }
  return {
    applied: active.length,
    shortlisted: shortlisted.size,
    interviewed: interviewed.size,
    hired: active.filter((a) => a.current_stage === "hired").length,
  };
}

export async function getTimeToFillTrend(
  recruiterId: string,
  scope: KpiScope = {},
): Promise<TimeToFillTrendPoint[]> {
  const since = sinceIso("quarter");
  const ctx = await loadRecruiterAppContext(recruiterId, since, scope);
  const hiredAt = hiredAtMap(ctx.history);
  const byWeek = new Map<string, number[]>();

  for (const app of ctx.apps) {
    const at = hiredAt.get(app.id);
    if (!at && app.current_stage !== "hired") continue;
    const end = at ?? app.updated_at;
    const week = weekStartIso(new Date(end));
    const list = byWeek.get(week) ?? [];
    list.push(daysBetween(app.created_at, end));
    byWeek.set(week, list);
  }

  const points: TimeToFillTrendPoint[] = [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7 * 7);
  for (let i = 0; i < 8; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const week = weekStartIso(d);
    const vals = byWeek.get(week) ?? [];
    points.push({
      weekStart: week,
      weekLabel: new Date(week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      avgDays: vals.length ? round1(avg(vals)) : null,
      hiredCount: vals.length,
    });
  }
  return points;
}

export async function getAppsReviewedTrend(
  recruiterId: string,
  scope: KpiScope = {},
): Promise<AppsReviewedTrendPoint[]> {
  const since = sinceIso("quarter");
  const ctx = await loadRecruiterAppContext(recruiterId, since, scope);
  const appIds = new Set(ctx.apps.map((a) => a.id));
  const byWeek = new Map<string, number>();
  for (const h of ctx.history) {
    if (h.actor_id !== recruiterId || !appIds.has(h.application_id)) continue;
    const week = weekStartIso(new Date(h.created_at));
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  const points: AppsReviewedTrendPoint[] = [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7 * 7);
  for (let i = 0; i < 8; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    const week = weekStartIso(d);
    points.push({
      weekStart: week,
      weekLabel: new Date(week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      count: byWeek.get(week) ?? 0,
    });
  }
  return points;
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
  if (filters.level) memQuery = memQuery.eq("recruiter_level", filters.level);

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
    const level = (m.recruiter_level as RecruiterLevel | null) ?? "generic";
    let kpisSummary = {
      timeToFill: 0,
      placementRate: 0,
      applicationsReviewedPerWeek: 0,
      offerToHireRatio: 0,
    };
    try {
      const kpis = await getRecruiterKPIs(
        m.user_id,
        "month",
        {},
        level,
        m.organization_id ?? undefined,
      );
      kpisSummary = {
        timeToFill: kpis.timeToFill,
        placementRate: kpis.placementRate,
        applicationsReviewedPerWeek: kpis.applicationsReviewedPerWeek,
        offerToHireRatio: kpis.offerToHireRatio,
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

/** Employers (companies) the recruiter has applications or role-scoped jobs for. */
export async function getRecruiterCompanies(recruiterId: string): Promise<KpiCompany[]> {
  const key = `companies:${recruiterId}`;
  const cached = cacheGet<KpiCompany[]>(key);
  if (cached) return cached;

  // Use a wide window so the dropdown stays useful even when the KPI range is Week
  const ctx = await loadRecruiterAppContext(recruiterId, sinceIso("quarter"), {});
  const counts = new Map<string, number>();
  for (const app of ctx.apps) {
    if (app.withdrawn_at) continue;
    const orgId = ctx.jobsById.get(app.job_order_id)?.employer_org_id;
    if (!orgId) continue;
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
  }

  // Also include employers from job_assignments even with zero apps in range
  const supabase = createClient();
  const { data: assignments } = await supabase
    .from("job_assignments")
    .select("job_order_id")
    .eq("recruiter_user_id", recruiterId);
  const assignedJobIds = (
    (assignments as { job_order_id: string }[] | null) ?? []
  ).map((a) => a.job_order_id);

  if (assignedJobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("job_orders")
      .select("employer_org_id")
      .in("id", assignedJobIds);
    for (const j of (jobs as { employer_org_id: string }[] | null) ?? []) {
      if (!counts.has(j.employer_org_id)) counts.set(j.employer_org_id, 0);
    }
  }

  const orgIds = [...counts.keys()];
  if (orgIds.length === 0) return cacheSet(key, []);

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id,name")
    .in("id", orgIds);

  const companies: KpiCompany[] = ((orgs as { id: string; name: string }[] | null) ?? [])
    .map((o) => ({
      id: o.id,
      name: o.name,
      applicationCount: counts.get(o.id) ?? 0,
    }))
    .sort((a, b) => b.applicationCount - a.applicationCount || a.name.localeCompare(b.name));

  return cacheSet(key, companies);
}

/** Resolve recruiter level + org for the signed-in user. */
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
    level: (m?.recruiter_level as RecruiterLevel | null) ?? "generic",
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
    level: (m?.recruiter_level as RecruiterLevel | null) ?? "generic",
    regionCode: m?.country_code ?? null,
    organizationId: m?.organization_id ?? null,
    organizationName,
  };
}
