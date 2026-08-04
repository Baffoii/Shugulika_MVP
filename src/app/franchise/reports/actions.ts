"use server";

import { revalidatePath } from "next/cache";
import { requirePortal, franchiseOrgId } from "@/lib/auth";
import { listKpiTargets, upsertKpiTarget } from "@/lib/data/recruiter-kpis";
import { normalizeRecruiterLevel } from "@/lib/rbac";
import {
  formatCeilingViolation,
  validateFranchiseTargetCeilings,
} from "@/lib/franchise/target-ceilings";

export async function saveFranchiseKpiTargetsAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePortal("franchise");
  if (!ctx.roles.includes("franchise_admin") && !ctx.roles.includes("hq_admin")) {
    return { ok: false, error: "Only franchise administrators can edit targets." };
  }
  const scoped = franchiseOrgId(ctx.memberships);
  const orgId = String(formData.get("organization_id") ?? "");
  if (!orgId || orgId !== scoped) {
    return { ok: false, error: "Organization out of scope." };
  }
  const level = normalizeRecruiterLevel(String(formData.get("recruiter_level") ?? "recruiter"));
  const num = (key: string) => Number(formData.get(key));
  const patch = {
    max_time_to_first_review_hours: num("max_time_to_first_review_hours"),
    max_time_to_client_submission_days: num("max_time_to_client_submission_days"),
    target_time_to_fill_days: num("target_time_to_fill_days"),
    target_placement_rate_pct: num("target_placement_rate_pct"),
    min_interview_conversion_pct: num("min_interview_conversion_pct"),
    min_client_submission_acceptance_pct: num("min_client_submission_acceptance_pct"),
    target_offer_to_hire_ratio_pct: num("target_offer_to_hire_ratio_pct"),
    max_active_workload: num("max_active_workload"),
    max_stalled_application_count: num("max_stalled_application_count"),
  };

  const platformTargets = await listKpiTargets(null);
  const platform = platformTargets.find((t) => t.recruiter_level === level) ?? null;
  const violations = validateFranchiseTargetCeilings(patch, platform);
  if (violations.length > 0) {
    return { ok: false, error: violations.map(formatCeilingViolation).join(" ") };
  }

  const result = await upsertKpiTarget({
    recruiterLevel: level,
    organizationId: orgId,
    patch,
  });
  if (result.ok) {
    revalidatePath("/franchise/reports");
    revalidatePath("/franchise/recruiters");
    revalidatePath("/franchise/capacity");
  }
  return result;
}
