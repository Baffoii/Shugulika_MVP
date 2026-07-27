"use server";

import { revalidatePath } from "next/cache";
import { requirePortal } from "@/lib/auth";
import { upsertKpiTarget } from "@/lib/data/recruiter-kpis";
import { normalizeRecruiterLevel } from "@/lib/rbac";

export async function saveHqKpiTargetsAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requirePortal("hq");
  if (!ctx.roles.includes("hq_admin")) {
    return { ok: false, error: "Only HQ administrators can edit platform targets." };
  }
  const orgRaw = String(formData.get("organization_id") ?? "");
  const organizationId = orgRaw ? orgRaw : null;
  const level = normalizeRecruiterLevel(String(formData.get("recruiter_level") ?? "recruiter"));
  const num = (key: string) => Number(formData.get(key));
  const result = await upsertKpiTarget({
    recruiterLevel: level,
    organizationId,
    patch: {
      max_time_to_first_review_hours: num("max_time_to_first_review_hours"),
      max_time_to_client_submission_days: num("max_time_to_client_submission_days"),
      target_time_to_fill_days: num("target_time_to_fill_days"),
      target_placement_rate_pct: num("target_placement_rate_pct"),
      min_interview_conversion_pct: num("min_interview_conversion_pct"),
      min_client_submission_acceptance_pct: num("min_client_submission_acceptance_pct"),
      target_offer_to_hire_ratio_pct: num("target_offer_to_hire_ratio_pct"),
      max_active_workload: num("max_active_workload"),
      max_stalled_application_count: num("max_stalled_application_count"),
    },
  });
  if (result.ok) revalidatePath("/hq/reports");
  return result;
}
