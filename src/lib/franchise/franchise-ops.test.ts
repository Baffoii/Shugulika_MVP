import { describe, expect, it } from "vitest";
import {
  formatCeilingViolation,
  validateFranchiseTargetCeilings,
} from "@/lib/franchise/target-ceilings";
import type { RecruiterKpiTargetRow } from "@/lib/database.types";
import {
  applicationAgeHours,
  isSlaOverdue,
  sanitizeFranchiseError,
} from "@/lib/franchise/employer-app-ops";
import {
  franchiseGrainToKpiPeriod,
  parseFranchisePeriodGrain,
  sortByName,
} from "@/lib/franchise/period";
import { assertNoCrossFranchiseFilter } from "@/lib/data/franchise-ops";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const platform: RecruiterKpiTargetRow = {
  id: "p1",
  recruiter_level: "recruiter",
  organization_id: null,
  target_time_to_fill_days: 30,
  target_placement_rate_pct: 40,
  target_apps_reviewed_per_week: 20,
  target_offer_to_hire_ratio_pct: 50,
  min_aptitude_test_score: null,
  max_time_to_first_review_hours: 24,
  max_time_to_client_submission_days: 7,
  min_interview_conversion_pct: 30,
  min_client_submission_acceptance_pct: 40,
  max_active_workload: 40,
  max_stalled_application_count: 10,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("franchise target ceilings", () => {
  it("rejects franchise overrides looser than HQ max_* ceilings", () => {
    const violations = validateFranchiseTargetCeilings(
      { max_active_workload: 80, max_time_to_first_review_hours: 48 },
      platform,
    );
    expect(violations.map((v) => v.key)).toEqual(
      expect.arrayContaining(["max_active_workload", "max_time_to_first_review_hours"]),
    );
  });

  it("rejects franchise overrides below HQ min_* floors", () => {
    const violations = validateFranchiseTargetCeilings(
      { target_placement_rate_pct: 10, min_interview_conversion_pct: 5 },
      platform,
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(formatCeilingViolation(violations[0]!)).toMatch(/cannot be below the HQ minimum/);
  });

  it("allows equal or stricter overrides", () => {
    const violations = validateFranchiseTargetCeilings(
      {
        max_active_workload: 30,
        max_time_to_first_review_hours: 12,
        target_placement_rate_pct: 50,
        min_interview_conversion_pct: 40,
      },
      platform,
    );
    expect(violations).toEqual([]);
  });
});

describe("franchise employer app ops helpers", () => {
  it("computes age and SLA overdue", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    expect(applicationAgeHours("2026-08-04T10:00:00.000Z", now)).toBe(2);
    expect(isSlaOverdue("2026-08-04T11:00:00.000Z", "submitted", now)).toBe(true);
    expect(isSlaOverdue("2026-08-04T13:00:00.000Z", "submitted", now)).toBe(false);
    expect(isSlaOverdue("2026-08-04T11:00:00.000Z", "approved", now)).toBe(false);
  });

  it("sanitizes errors so foreign UUIDs are not leaked", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(sanitizeFranchiseError(`boom ${id}`)).not.toContain(id);
    expect(sanitizeFranchiseError("Application not found")).toBe("Application not found");
    expect(sanitizeFranchiseError("Owner must belong to the assigned franchise")).toMatch(
      /belong to your franchise/i,
    );
  });
});

describe("franchise period helpers", () => {
  it("maps grains onto KPI periods without editing shared PeriodSelect", () => {
    expect(parseFranchisePeriodGrain("day")).toBe("day");
    expect(franchiseGrainToKpiPeriod("day")).toBe("7d");
    expect(franchiseGrainToKpiPeriod("month")).toBe("30d");
    expect(franchiseGrainToKpiPeriod("year")).toBe("ytd");
  });

  it("sorts alphabetically", () => {
    const rows = sortByName(
      [{ name: "Zulu Co" }, { name: "Alpha Ltd" }],
      "alpha_asc",
    );
    expect(rows.map((r) => r.name)).toEqual(["Alpha Ltd", "Zulu Co"]);
  });
});

describe("franchise isolation contracts", () => {
  it("rejects cross-franchise filter keys on franchise loaders", () => {
    expect(() => assertNoCrossFranchiseFilter({ status: "submitted" })).not.toThrow();
    expect(() => assertNoCrossFranchiseFilter({ franchiseOrgId: "other" })).toThrow(
      /Cross-franchise/,
    );
  });

  it("does not import recruiter KPI definitions for mutation from franchise UI components", () => {
    const root = join(process.cwd(), "src", "components", "franchise");
    function files(dir: string, out: string[] = []): string[] {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) files(path, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(path);
      }
      return out;
    }
    for (const file of files(root)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/upsertKpiTarget|from \"@\/lib\/kpi\/definitions\"/);
    }
  });

  it("keeps franchise migrations in the 20260806 namespace only", () => {
    const mig = join(process.cwd(), "supabase", "migrations");
    const franchiseMigs = readdirSync(mig).filter((f) => f.includes("franchise"));
    for (const f of franchiseMigs) {
      if (f.startsWith("20260806")) continue;
      // Older franchise-related names may exist; this workstream's new files must be 20260806*
      if (f.includes("employer_app_owner") || f.includes("franchise_ops")) {
        expect(f.startsWith("20260806")).toBe(true);
      }
    }
    expect(
      readdirSync(mig).some((f) => f.startsWith("20260806") && f.includes("franchise")),
    ).toBe(true);
    expect(readdirSync(mig).some((f) => f.startsWith("20260805") && f.includes("franchise"))).toBe(
      false,
    );
    expect(readdirSync(mig).some((f) => f.startsWith("20260807") && f.includes("franchise"))).toBe(
      false,
    );
  });
});
