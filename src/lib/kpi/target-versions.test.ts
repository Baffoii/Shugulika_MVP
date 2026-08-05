import { describe, it, expect } from "vitest";
import {
  describeTargetVersion,
  metricsFromPayload,
  periodElapsedPct,
  resolveTargetsAt,
  targetProgress,
  versionCovers,
  type KpiTargetMetrics,
  type TargetVersionRecord,
} from "@/lib/kpi/target-versions";
import { grainToWindow, targetResolutionInstant } from "@/lib/kpi/filters";

const DEFAULTS: KpiTargetMetrics = {
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
};

function version(
  partial: Partial<TargetVersionRecord> & Pick<TargetVersionRecord, "id">,
): TargetVersionRecord {
  return {
    targetId: "target-1",
    organizationId: null,
    recruiterLevel: "recruiter",
    metrics: DEFAULTS,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    supersededAt: null,
    changedBy: null,
    ...partial,
  };
}

describe("version windows", () => {
  it("treats [effective_from, superseded_at) as half-open", () => {
    const v = version({
      id: "v1",
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      supersededAt: "2026-07-01T00:00:00.000Z",
    });
    expect(versionCovers(v, "2026-05-31T23:59:59.000Z")).toBe(false);
    expect(versionCovers(v, "2026-06-01T00:00:00.000Z")).toBe(true);
    expect(versionCovers(v, "2026-06-30T23:59:59.000Z")).toBe(true);
    expect(versionCovers(v, "2026-07-01T00:00:00.000Z")).toBe(false);
  });
});

describe("resolveTargetsAt — recomputing a closed period", () => {
  // The acceptance case: a target changed on 1 July. Recomputing June must keep
  // June's target; July onwards uses the new one.
  const june = version({
    id: "v-june",
    metrics: { ...DEFAULTS, placementRatePct: 60 },
    effectiveFrom: "2026-06-01T00:00:00.000Z",
    supersededAt: "2026-07-01T00:00:00.000Z",
  });
  const july = version({
    id: "v-july",
    metrics: { ...DEFAULTS, placementRatePct: 85 },
    effectiveFrom: "2026-07-01T00:00:00.000Z",
    supersededAt: null,
  });

  it("uses the version in force at the period end, not the latest", () => {
    // The June window is [Jun 1, Jul 1). `targetResolutionInstant` hands us the
    // last instant *inside* it, which must still resolve to June's target even
    // though the new one took effect the moment the period closed.
    const june30 = targetResolutionInstant(
      grainToWindow(
        { grain: "custom", from: "2026-06-01", to: "2026-06-30" },
        new Date("2026-08-04T00:00:00.000Z"),
      ),
      new Date("2026-08-04T00:00:00.000Z"),
    );
    expect(june30).toBe("2026-06-30T23:59:59.999Z");

    const closed = resolveTargetsAt({
      versions: [june, july],
      recruiterLevel: "recruiter",
      organizationId: null,
      atIso: june30,
      platformDefaults: DEFAULTS,
    });
    expect(closed.targetVersionId).toBe("v-june");
    expect(closed.metrics.placementRatePct).toBe(60);
    expect(closed.basis).toBe("version_at_period_end");
  });

  it("uses the current version for an open period", () => {
    const open = resolveTargetsAt({
      versions: [june, july],
      recruiterLevel: "recruiter",
      organizationId: null,
      atIso: "2026-08-04T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(open.targetVersionId).toBe("v-july");
    expect(open.metrics.placementRatePct).toBe(85);
  });

  it("prefers a franchise override that was in force, and ignores one created later", () => {
    const orgOverride = version({
      id: "v-org",
      targetId: "target-org",
      organizationId: "org-1",
      metrics: { ...DEFAULTS, placementRatePct: 90 },
      effectiveFrom: "2026-07-15T00:00:00.000Z",
    });

    // June predates the override → platform version wins.
    const inJune = resolveTargetsAt({
      versions: [june, july, orgOverride],
      recruiterLevel: "recruiter",
      organizationId: "org-1",
      atIso: "2026-06-15T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(inJune.targetVersionId).toBe("v-june");
    expect(inJune.source).toBe("platform");

    // August is after the override → franchise version wins.
    const inAugust = resolveTargetsAt({
      versions: [june, july, orgOverride],
      recruiterLevel: "recruiter",
      organizationId: "org-1",
      atIso: "2026-08-01T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(inAugust.targetVersionId).toBe("v-org");
    expect(inAugust.source).toBe("franchise");
  });

  it("never borrows another level's target", () => {
    const seniorOnly = version({ id: "v-senior", recruiterLevel: "senior" });
    const r = resolveTargetsAt({
      versions: [seniorOnly],
      recruiterLevel: "junior",
      organizationId: null,
      atIso: "2026-07-01T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(r.targetVersionId).toBeNull();
    expect(r.basis).toBe("platform_defaults");
  });

  it("falls back to the earliest version, flagged, when every version postdates the period", () => {
    const r = resolveTargetsAt({
      versions: [july],
      recruiterLevel: "recruiter",
      organizationId: null,
      atIso: "2026-02-01T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(r.targetVersionId).toBe("v-july");
    expect(r.basis).toBe("earliest_version");
    expect(describeTargetVersion(r)).toContain("No platform target existed at period end");
  });

  it("falls back to in-code defaults with no history at all", () => {
    const r = resolveTargetsAt({
      versions: [],
      recruiterLevel: "recruiter",
      organizationId: null,
      atIso: "2026-07-01T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(r.metrics).toEqual(DEFAULTS);
    expect(r.basis).toBe("platform_defaults");
    expect(r.targetVersionId).toBeNull();
  });
});

describe("metricsFromPayload", () => {
  it("maps the stored snake_case snapshot", () => {
    const m = metricsFromPayload(
      {
        max_time_to_first_review_hours: 24,
        target_placement_rate_pct: 80,
        target_time_to_fill_days: 10,
      },
      DEFAULTS,
    );
    expect(m.maxTimeToFirstReviewHours).toBe(24);
    expect(m.placementRatePct).toBe(80);
    expect(m.timeToFillDays).toBe(10);
  });

  it("fills keys the snapshot predates from the supplied fallback, not from today", () => {
    const m = metricsFromPayload({ target_placement_rate_pct: 80 }, DEFAULTS);
    expect(m.maxActiveWorkload).toBe(DEFAULTS.maxActiveWorkload);
  });

  it("ignores a null or non-numeric payload value", () => {
    const m = metricsFromPayload({ max_active_workload: null }, DEFAULTS);
    expect(m.maxActiveWorkload).toBe(40);
    expect(metricsFromPayload(null, DEFAULTS)).toEqual(DEFAULTS);
  });
});

describe("progress helpers", () => {
  it("reports remaining and capped percentage", () => {
    expect(targetProgress({ achieved: 5, target: 20 })).toEqual({ pct: 25, remaining: 15 });
    expect(targetProgress({ achieved: 25, target: 20 })).toEqual({ pct: 100, remaining: 0 });
    expect(targetProgress({ achieved: 5, target: 0 })).toEqual({ pct: null, remaining: 0 });
  });

  it("reports how much of the period has elapsed", () => {
    const w = { since: "2026-07-01T00:00:00.000Z", until: "2026-07-11T00:00:00.000Z" };
    expect(periodElapsedPct(w, "2026-07-06T00:00:00.000Z")).toBe(50);
    expect(periodElapsedPct(w, "2026-06-01T00:00:00.000Z")).toBe(0);
    expect(periodElapsedPct(w, "2026-08-01T00:00:00.000Z")).toBe(100);
  });
});
