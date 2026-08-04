/**
 * Versioned KPI targets — pure resolution, no I/O.
 *
 * `recruiter_kpi_targets` only ever holds the *current* row. Recomputing a
 * closed past period must use whatever target was in force at that period's
 * end, otherwise a target change silently rewrites history. The trigger in
 * `20260805090000_recruiter_kpi_target_versions.sql` snapshots every write into
 * `recruiter_kpi_target_versions`; this module picks the right snapshot.
 *
 * Local types (rather than @/lib/database.types) because the generated types
 * are not regenerated in this workstream.
 */

/** Mirrors RecruiterLevel in @/lib/rbac — duplicated locally to keep this module I/O-free. */
export type RecruiterLevelKey = "junior" | "recruiter" | "senior" | "head_recruiter";

export type TargetSourceKey = "platform" | "franchise" | "recruiter_override";

/** The metric payload of a target row, camelCased. */
export interface KpiTargetMetrics {
  maxTimeToFirstReviewHours: number;
  maxTimeToClientSubmissionDays: number;
  timeToFillDays: number;
  placementRatePct: number;
  interviewConversionPct: number;
  clientSubmissionAcceptancePct: number;
  offerToHireRatioPct: number;
  maxActiveWorkload: number;
  maxStalledApplicationCount: number;
  /** Informational in MVP cards — kept for the franchise targets form. */
  appsReviewedPerWeek: number;
}

export interface TargetVersionRecord {
  id: string;
  targetId: string | null;
  organizationId: string | null;
  recruiterLevel: RecruiterLevelKey;
  metrics: KpiTargetMetrics;
  /** Inclusive. */
  effectiveFrom: string;
  /** Exclusive; null means "still current". */
  supersededAt: string | null;
  changedBy: string | null;
}

/**
 * How the effective target was determined. Surfaced in the UI so a recruiter
 * can tell "my target changed mid-period" from "this is today's target".
 */
export type TargetResolutionBasis =
  "version_at_period_end" | "earliest_version" | "current_row" | "platform_defaults";

export interface ResolvedTargets {
  metrics: KpiTargetMetrics;
  source: TargetSourceKey;
  basis: TargetResolutionBasis;
  targetVersionId: string | null;
  targetId: string | null;
  effectiveFrom: string | null;
  supersededAt: string | null;
  /** The instant the version was resolved at (period end, not "now"). */
  resolvedAt: string;
}

/** Raw jsonb payload keys as stored by the snapshot trigger (to_jsonb of the row). */
interface TargetMetricsPayload {
  max_time_to_first_review_hours?: number | null;
  max_time_to_client_submission_days?: number | null;
  target_time_to_fill_days?: number | null;
  target_placement_rate_pct?: number | null;
  min_interview_conversion_pct?: number | null;
  min_client_submission_acceptance_pct?: number | null;
  target_offer_to_hire_ratio_pct?: number | null;
  max_active_workload?: number | null;
  max_stalled_application_count?: number | null;
  target_apps_reviewed_per_week?: number | null;
}

function num(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Map a stored snapshot payload onto the metric shape, filling any key the
 * snapshot predates from `fallback` (never from "now"'s live row).
 */
export function metricsFromPayload(payload: unknown, fallback: KpiTargetMetrics): KpiTargetMetrics {
  const p = (payload ?? {}) as TargetMetricsPayload;
  return {
    maxTimeToFirstReviewHours: num(
      p.max_time_to_first_review_hours,
      fallback.maxTimeToFirstReviewHours,
    ),
    maxTimeToClientSubmissionDays: num(
      p.max_time_to_client_submission_days,
      fallback.maxTimeToClientSubmissionDays,
    ),
    timeToFillDays: num(p.target_time_to_fill_days, fallback.timeToFillDays),
    placementRatePct: num(p.target_placement_rate_pct, fallback.placementRatePct),
    interviewConversionPct: num(p.min_interview_conversion_pct, fallback.interviewConversionPct),
    clientSubmissionAcceptancePct: num(
      p.min_client_submission_acceptance_pct,
      fallback.clientSubmissionAcceptancePct,
    ),
    offerToHireRatioPct: num(p.target_offer_to_hire_ratio_pct, fallback.offerToHireRatioPct),
    maxActiveWorkload: num(p.max_active_workload, fallback.maxActiveWorkload),
    maxStalledApplicationCount: num(
      p.max_stalled_application_count,
      fallback.maxStalledApplicationCount,
    ),
    appsReviewedPerWeek: num(p.target_apps_reviewed_per_week, fallback.appsReviewedPerWeek),
  };
}

/** True when `atIso` falls inside the version's [effective_from, superseded_at) window. */
export function versionCovers(version: TargetVersionRecord, atIso: string): boolean {
  if (version.effectiveFrom > atIso) return false;
  return version.supersededAt == null || atIso < version.supersededAt;
}

function pickCovering(
  versions: TargetVersionRecord[],
  atIso: string,
): TargetVersionRecord | undefined {
  return versions
    .filter((v) => versionCovers(v, atIso))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

function earliest(versions: TargetVersionRecord[]): TargetVersionRecord | undefined {
  return [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
}

/**
 * Resolve the target in force at `atIso` (the *period end*, never "now").
 *
 * Precedence, highest first:
 *   1. Franchise-scoped version covering the instant
 *   2. Platform (organization_id null) version covering the instant
 *   3. Earliest franchise/platform version, when every version starts after the
 *      period ended (target created later — flagged as `earliest_version`)
 *   4. In-code platform defaults
 *
 * A franchise override created *after* the period ended deliberately does not
 * apply to that period: precedence 2 wins, which is the whole point of
 * versioning.
 */
export function resolveTargetsAt(input: {
  versions: TargetVersionRecord[];
  recruiterLevel: RecruiterLevelKey;
  organizationId: string | null | undefined;
  atIso: string;
  platformDefaults: KpiTargetMetrics;
}): ResolvedTargets {
  const { versions, recruiterLevel, organizationId, atIso, platformDefaults } = input;
  const forLevel = versions.filter((v) => v.recruiterLevel === recruiterLevel);
  const orgVersions = organizationId
    ? forLevel.filter((v) => v.organizationId === organizationId)
    : [];
  const platformVersions = forLevel.filter((v) => v.organizationId == null);

  const tiers: { source: TargetSourceKey; rows: TargetVersionRecord[] }[] = [
    { source: "franchise", rows: orgVersions },
    { source: "platform", rows: platformVersions },
  ];

  for (const tier of tiers) {
    const hit = pickCovering(tier.rows, atIso);
    if (hit) return toResolved(hit, tier.source, "version_at_period_end", atIso);
  }

  for (const tier of tiers) {
    const hit = earliest(tier.rows);
    if (hit) return toResolved(hit, tier.source, "earliest_version", atIso);
  }

  return {
    metrics: platformDefaults,
    source: "platform",
    basis: "platform_defaults",
    targetVersionId: null,
    targetId: null,
    effectiveFrom: null,
    supersededAt: null,
    resolvedAt: atIso,
  };
}

function toResolved(
  version: TargetVersionRecord,
  source: TargetSourceKey,
  basis: TargetResolutionBasis,
  atIso: string,
): ResolvedTargets {
  return {
    metrics: version.metrics,
    source,
    basis,
    targetVersionId: version.id,
    targetId: version.targetId,
    effectiveFrom: version.effectiveFrom,
    supersededAt: version.supersededAt,
    resolvedAt: atIso,
  };
}

/** Human-readable provenance line for the "target version used" affordance. */
export function describeTargetVersion(resolved: ResolvedTargets): string {
  const from = resolved.effectiveFrom ? resolved.effectiveFrom.slice(0, 10) : null;
  const to = resolved.supersededAt ? resolved.supersededAt.slice(0, 10) : null;
  switch (resolved.basis) {
    case "version_at_period_end":
      return `${resolved.source} target in force at period end (from ${from}${
        to ? ` to ${to}` : ", current"
      })`;
    case "earliest_version":
      return `No ${resolved.source} target existed at period end — using the earliest recorded version (from ${from})`;
    case "current_row":
      return `${resolved.source} target (current row; no version history)`;
    case "platform_defaults":
      return "No stored target — using in-code platform defaults";
  }
}

/** Progress of a countable target within the period (0–100, null when no target). */
export function targetProgress(input: { achieved: number; target: number }): {
  pct: number | null;
  remaining: number;
} {
  if (!Number.isFinite(input.target) || input.target <= 0) {
    return { pct: null, remaining: 0 };
  }
  const remaining = Math.max(0, input.target - input.achieved);
  const pct = Math.round(Math.min(100, (input.achieved / input.target) * 100) * 10) / 10;
  return { pct, remaining };
}

/** Elapsed share of the selected window, so "behind pace" can be shown honestly. */
export function periodElapsedPct(window: { since: string; until: string }, nowIso: string): number {
  const start = new Date(window.since).getTime();
  const end = new Date(window.until).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 100;
  if (now >= end) return 100;
  if (now <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 1000) / 10;
}
