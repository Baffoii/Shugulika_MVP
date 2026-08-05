/**
 * Regression guard: nationality must never become a KPI filter, score, or rank
 * signal. Tanzania's Employment and Labour Relations Act prohibits employment
 * discrimination on nationality and covers applicants, so this is a legal
 * constraint, not a style preference.
 *
 * The test reads the KPI source tree directly, so a future contributor cannot
 * reintroduce the field by adding a new module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_FILTER_KEYS,
  PROHIBITED_FILTER_KEYS,
  containsProhibitedFilterKey,
  parseKpiFilters,
} from "@/lib/kpi/filters";
import { buildAttentionQueue } from "@/lib/kpi/attention";

const KPI_DIR = join(process.cwd(), "src", "lib", "kpi");
const PROTECTED_TERMS = ["nationality", "citizenship", "national_origin", "ethnicity", "religion"];

function kpiSourceFiles(): string[] {
  return readdirSync(KPI_DIR)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !f.endsWith(".test.ts"))
    .map((f) => join(KPI_DIR, f));
}

describe("nationality is never a KPI signal", () => {
  it("no KPI module reads a protected characteristic off any record", () => {
    for (const file of kpiSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const term of PROTECTED_TERMS) {
        // filters.ts names these terms only to *block* them.
        const allowedMentions = file.endsWith("filters.ts");
        const mentions = source.toLowerCase().includes(term);
        if (mentions && !allowedMentions) {
          throw new Error(`${file} references the protected characteristic "${term}"`);
        }
      }
    }
  });

  it("filters.ts mentions these terms only inside the prohibited list", () => {
    expect(PROHIBITED_FILTER_KEYS).toContain("nationality");
    expect(PROHIBITED_FILTER_KEYS).toContain("citizenship");
    expect(PROHIBITED_FILTER_KEYS).toContain("national_origin");
    expect(ALLOWED_FILTER_KEYS.some((k) => PROTECTED_TERMS.includes(k))).toBe(false);
  });

  it("a nationality query parameter is dropped, not honoured", () => {
    const parsed = parseKpiFilters({ nationality: "TZ", citizenship: "KE", grain: "month" });
    expect(JSON.stringify(parsed)).not.toContain("TZ");
    expect(JSON.stringify(parsed)).not.toContain("KE");
    expect(containsProhibitedFilterKey(Object.keys(parsed))).toBe(false);
  });

  it("attention items expose no protected characteristic", () => {
    const queue = buildAttentionQueue({
      recruiterId: "rec-1",
      nowIso: "2026-07-27T12:00:00.000Z",
      apps: [
        {
          id: "a1",
          assignedRecruiterId: "rec-1",
          currentStage: "cv_review",
          createdAt: "2026-07-01T00:00:00.000Z",
          withdrawnAt: null,
          rejectedAt: null,
          rejectedFromStage: null,
          rejectionReason: null,
          jobOrderId: "job-1",
          owningOrgId: "org-1",
        },
      ],
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
    });

    expect(queue.items.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(queue).toLowerCase();
    for (const term of PROTECTED_TERMS) {
      expect(serialized).not.toContain(term);
    }
  });
});

describe("ATS work-eligibility never leaks into KPI filters", () => {
  // Work AUTHORIZATION ("may this person legally work here") is lawful and
  // job-related. It is still not a KPI dimension, and it must never become a
  // back door for the nationality filter the rest of this file bans.
  const ELIGIBILITY_KEYS = [
    "work_authorization",
    "workauthorization",
    "eligibility_status",
    "permit_type",
    "right_to_work",
    "visa",
    "work_permit",
  ];

  it("no KPI module reads a work-eligibility field", () => {
    for (const file of kpiSourceFiles()) {
      const source = readFileSync(file, "utf8").toLowerCase();
      for (const key of ELIGIBILITY_KEYS) {
        expect(source).not.toContain(key);
      }
    }
  });

  it("a work-eligibility query parameter is dropped like any other unknown key", () => {
    const parsed = parseKpiFilters({
      grain: "month",
      work_authorization: "eligible_with_permit",
      permit_type: "class-B",
      visa: "yes",
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("eligible_with_permit");
    expect(serialized).not.toContain("class-B");
    expect(Object.keys(parsed).sort()).toEqual(
      ["employerOrgId", "from", "grain", "jobOrderId", "kind", "roleId", "stage", "to"].sort(),
    );
  });

  it("the prohibited list stays a superset of every nationality synonym", () => {
    for (const synonym of ["nationality", "nationalities", "citizenship", "national_origin"]) {
      expect(containsProhibitedFilterKey([synonym])).toBe(true);
      expect(containsProhibitedFilterKey([synonym.toUpperCase()])).toBe(true);
    }
  });

  it("no allowed filter key is a protected characteristic or an eligibility field", () => {
    for (const key of ALLOWED_FILTER_KEYS) {
      expect(PROTECTED_TERMS).not.toContain(key);
      expect(ELIGIBILITY_KEYS).not.toContain(key);
    }
  });
});

describe("AI-derived signals stay advisory", () => {
  it("no KPI module can reject, decide, or auto-advance", () => {
    // KPI code summarizes and flags; the decision to reject or advance lives in
    // the pipeline RPCs, which require a human actor.
    const forbidden = [
      "auto_reject",
      "autoReject",
      "auto_advance",
      "autoAdvance",
      "advance_application",
      "reject_application",
    ];
    for (const file of kpiSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const term of forbidden) {
        expect(source).not.toContain(term);
      }
    }
  });
});
