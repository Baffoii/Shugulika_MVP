import { describe, it, expect } from "vitest";
import {
  ALLOWED_FILTER_KEYS,
  PROHIBITED_FILTER_KEYS,
  constrainFiltersToOptions,
  containsProhibitedFilterKey,
  grainToWindow,
  parseGrain,
  parseKpiFilters,
  serializeKpiFilters,
  targetResolutionInstant,
} from "@/lib/kpi/filters";

describe("filter key policy", () => {
  it("never allows a nationality filter", () => {
    expect(ALLOWED_FILTER_KEYS).not.toContain("nationality");
    expect(containsProhibitedFilterKey(["nationality"])).toBe(true);
    expect(containsProhibitedFilterKey(["Nationality"])).toBe(true);
    expect(containsProhibitedFilterKey(["citizenship", "national_origin"])).toBe(true);
    expect(PROHIBITED_FILTER_KEYS).toContain("nationality");
  });

  it("never allows re-scoping to another recruiter or organization", () => {
    for (const key of ["recruiter", "recruiterId", "owner", "assignee", "organizationId", "org"]) {
      expect(containsProhibitedFilterKey([key])).toBe(true);
      expect(ALLOWED_FILTER_KEYS).not.toContain(key);
    }
  });

  it("allows the intended filters only", () => {
    expect(containsProhibitedFilterKey([...ALLOWED_FILTER_KEYS])).toBe(false);
  });
});

describe("parseKpiFilters", () => {
  it("drops recruiter, organization, and nationality parameters entirely", () => {
    const parsed = parseKpiFilters({
      grain: "week",
      recruiter: "rec-2",
      recruiterId: "rec-2",
      owner: "rec-2",
      organizationId: "org-9",
      nationality: "TZ",
      role: "role-1",
    });
    expect(parsed).toEqual({
      grain: "week",
      from: undefined,
      to: undefined,
      roleId: "role-1",
      employerOrgId: undefined,
      jobOrderId: undefined,
      stage: undefined,
      kind: undefined,
    });
    expect(JSON.stringify(parsed)).not.toContain("rec-2");
    expect(JSON.stringify(parsed)).not.toContain("org-9");
    expect(JSON.stringify(parsed)).not.toContain("TZ");
  });

  it("rejects malformed custom dates instead of passing them through", () => {
    const parsed = parseKpiFilters({ grain: "custom", from: "not-a-date", to: "2026-07-31" });
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBe("2026-07-31");
  });

  it("falls back to month for unknown or missing grains, and maps legacy periods", () => {
    expect(parseGrain(undefined)).toBe("month");
    expect(parseGrain("nonsense")).toBe("month");
    expect(parseGrain("7d")).toBe("week");
    expect(parseGrain("ytd")).toBe("year");
    expect(parseKpiFilters({ range: "7d" }).grain).toBe("week");
  });

  it("takes the first value of a repeated parameter and ignores blanks", () => {
    expect(parseKpiFilters({ role: ["role-1", "role-2"] }).roleId).toBe("role-1");
    expect(parseKpiFilters({ role: "   " }).roleId).toBeUndefined();
  });
});

describe("constrainFiltersToOptions", () => {
  const options = {
    roleIds: ["role-1"],
    employerOrgIds: ["emp-1"],
    jobOrderIds: ["job-1"],
    stages: ["cv_review"],
  };

  it("keeps values the recruiter owns", () => {
    const out = constrainFiltersToOptions(
      {
        grain: "month",
        roleId: "role-1",
        employerOrgId: "emp-1",
        jobOrderId: "job-1",
        stage: "cv_review",
      },
      options,
    );
    expect(out.roleId).toBe("role-1");
    expect(out.jobOrderId).toBe("job-1");
  });

  it("silently drops ids outside the recruiter's own options", () => {
    // Dropping (rather than erroring) means the response never confirms that a
    // guessed job/employer id exists.
    const out = constrainFiltersToOptions(
      {
        grain: "month",
        roleId: "role-someone-else",
        employerOrgId: "emp-someone-else",
        jobOrderId: "job-someone-else",
        stage: "made_up_stage",
      },
      options,
    );
    expect(out.roleId).toBeUndefined();
    expect(out.employerOrgId).toBeUndefined();
    expect(out.jobOrderId).toBeUndefined();
    expect(out.stage).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("someone-else");
  });
});

describe("grainToWindow", () => {
  const now = new Date("2026-07-15T09:30:00.000Z"); // a Wednesday

  it("day covers the current UTC day", () => {
    const w = grainToWindow({ grain: "day" }, now);
    expect(w.since).toBe("2026-07-15T00:00:00.000Z");
    expect(w.until).toBe("2026-07-16T00:00:00.000Z");
    expect(w.isClosed).toBe(false);
  });

  it("week starts on Monday", () => {
    const w = grainToWindow({ grain: "week" }, now);
    expect(w.since).toBe("2026-07-13T00:00:00.000Z");
    expect(w.until).toBe("2026-07-20T00:00:00.000Z");
  });

  it("month and year cover calendar periods", () => {
    expect(grainToWindow({ grain: "month" }, now).since).toBe("2026-07-01T00:00:00.000Z");
    expect(grainToWindow({ grain: "month" }, now).until).toBe("2026-08-01T00:00:00.000Z");
    expect(grainToWindow({ grain: "year" }, now).since).toBe("2026-01-01T00:00:00.000Z");
    expect(grainToWindow({ grain: "year" }, now).until).toBe("2027-01-01T00:00:00.000Z");
  });

  it("custom includes the whole `to` day and is marked closed once it has passed", () => {
    const w = grainToWindow({ grain: "custom", from: "2026-06-01", to: "2026-06-30" }, now);
    expect(w.since).toBe("2026-06-01T00:00:00.000Z");
    expect(w.until).toBe("2026-07-01T00:00:00.000Z");
    expect(w.isClosed).toBe(true);
  });

  it("falls back to the month window when custom dates are incomplete", () => {
    const w = grainToWindow({ grain: "custom", from: "2026-06-01" }, now);
    expect(w.grain).toBe("month");
  });
});

describe("targetResolutionInstant", () => {
  const now = new Date("2026-07-15T09:30:00.000Z");

  it("uses the last instant inside a closed period, not its exclusive end", () => {
    // Resolving at `until` would pick up a target that took effect the instant
    // the period closed — the drift versioning exists to prevent.
    const closed = grainToWindow({ grain: "custom", from: "2026-06-01", to: "2026-06-30" }, now);
    expect(closed.until).toBe("2026-07-01T00:00:00.000Z");
    expect(targetResolutionInstant(closed, now)).toBe("2026-06-30T23:59:59.999Z");
  });

  it("uses now for a period still running", () => {
    const open = grainToWindow({ grain: "month" }, now);
    expect(targetResolutionInstant(open, now)).toBe(now.toISOString());
  });
});

describe("serializeKpiFilters", () => {
  it("round-trips through parseKpiFilters", () => {
    const filters = {
      grain: "custom" as const,
      from: "2026-06-01",
      to: "2026-06-30",
      roleId: "role-1",
      employerOrgId: "emp-1",
      jobOrderId: "job-1",
      stage: "cv_review",
      kind: "stalled_in_stage",
    };
    const qs = serializeKpiFilters(filters);
    const params = Object.fromEntries(new URLSearchParams(qs).entries());
    expect(parseKpiFilters(params)).toEqual(filters);
  });

  it("omits custom dates when the grain is not custom", () => {
    expect(serializeKpiFilters({ grain: "week", from: "2026-06-01", to: "2026-06-30" })).toBe(
      "grain=week",
    );
  });
});
