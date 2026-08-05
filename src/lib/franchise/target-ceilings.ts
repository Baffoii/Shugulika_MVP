import type { RecruiterKpiTargetRow } from "@/lib/database.types";
import {
  FRANCHISE_TARGET_MAX_KEYS,
  FRANCHISE_TARGET_MIN_KEYS,
  type FranchiseTargetMetricKey,
} from "@/lib/franchise/types";

export type TargetCeilingViolation = {
  key: FranchiseTargetMetricKey;
  proposed: number;
  platform: number;
  rule: "must_be_lte_platform" | "must_be_gte_platform";
};

/**
 * Franchise overrides must stay inside the HQ/platform framework:
 * - max_* / time ceilings: franchise value ≤ platform (stricter or equal)
 * - min_* / rate floors: franchise value ≥ platform (stricter or equal)
 */
export function validateFranchiseTargetCeilings(
  proposed: Partial<RecruiterKpiTargetRow>,
  platform: RecruiterKpiTargetRow | null,
): TargetCeilingViolation[] {
  if (!platform) return [];
  const violations: TargetCeilingViolation[] = [];

  for (const key of FRANCHISE_TARGET_MAX_KEYS) {
    const value = proposed[key];
    const ceiling = platform[key];
    if (typeof value !== "number" || typeof ceiling !== "number" || Number.isNaN(value)) continue;
    if (value > ceiling) {
      violations.push({
        key,
        proposed: value,
        platform: ceiling,
        rule: "must_be_lte_platform",
      });
    }
  }

  for (const key of FRANCHISE_TARGET_MIN_KEYS) {
    const value = proposed[key];
    const floor = platform[key];
    if (typeof value !== "number" || typeof floor !== "number" || Number.isNaN(value)) continue;
    if (value < floor) {
      violations.push({
        key,
        proposed: value,
        platform: floor,
        rule: "must_be_gte_platform",
      });
    }
  }

  return violations;
}

export function formatCeilingViolation(v: TargetCeilingViolation): string {
  if (v.rule === "must_be_lte_platform") {
    return `${v.key} cannot exceed the HQ maximum of ${v.platform} (got ${v.proposed}).`;
  }
  return `${v.key} cannot be below the HQ minimum of ${v.platform} (got ${v.proposed}).`;
}
