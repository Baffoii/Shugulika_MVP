"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedEmployer } from "@/lib/auth";
import {
  ADDON_PACKAGE_KEYS,
  SUBSCRIPTION_PACKAGE_KEYS,
  type AddonPackageKey,
  type SubscriptionPackageKey,
} from "@/lib/employer-entitlements";

export type PlanActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
};

function rpcErrorMessage(error: { message?: string } | null): string {
  const raw = error?.message ?? "Something went wrong.";
  // PostgREST wraps raise exception as "..." — surface the useful part.
  const match = raw.match(/exception:\s*(.+)$/i) ?? raw.match(/ERROR:\s*(.+)$/i);
  return (match?.[1] ?? raw).trim();
}

/** Activate a subscription package or free trial. Payments are open (instant grant). */
export async function activateEmployerPackageAction(
  packageKey: string,
  asTrial = false,
): Promise<PlanActionResult> {
  await requireApprovedEmployer();
  if (!SUBSCRIPTION_PACKAGE_KEYS.includes(packageKey as SubscriptionPackageKey)) {
    return { ok: false, error: "Unknown package." };
  }
  // Trial package always runs as trial; paid packages ignore asTrial unless key is trial.
  const trial = packageKey === "trial" ? true : asTrial;
  const supabase = createClient();
  const { error } = await supabase.rpc("activate_employer_package", {
    p_package_key: packageKey,
    p_as_trial: trial,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  revalidatePath("/employer", "layout");
  revalidatePath("/employer/plan");
  revalidatePath("/employer/billing");
  redirect("/employer/dashboard");
}

/** Buy a CV unlock or job-slot top-up. Payments are open (instant grant). */
export async function purchaseEmployerAddonAction(addonKey: string): Promise<PlanActionResult> {
  await requireApprovedEmployer();
  if (!ADDON_PACKAGE_KEYS.includes(addonKey as AddonPackageKey)) {
    return { ok: false, error: "Unknown add-on." };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("purchase_employer_addon", {
    p_addon_key: addonKey,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  revalidatePath("/employer", "layout");
  revalidatePath("/employer/billing");
  revalidatePath("/employer/submissions");
  revalidatePath("/employer/find-candidates");
  return { ok: true, message: "Top-up applied." };
}

/**
 * Spend one CV unlock to reveal a candidate (Path B submission or Path A pool).
 * Unlock is org-scoped. Path A requires jobOrderId for authorization.
 */
export async function unlockEmployerCvAction(
  candidateId: string,
  submissionId?: string | null,
  jobOrderId?: string | null,
): Promise<PlanActionResult> {
  await requireApprovedEmployer();
  if (!submissionId && !jobOrderId) {
    return {
      ok: false,
      error: "Unlock requires a Path B submission or a Direct (Path A) job order.",
    };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("spend_cv_unlock", {
    p_candidate_id: candidateId,
    p_submission_id: submissionId ?? null,
    p_job_order_id: jobOrderId ?? null,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  if (submissionId) {
    revalidatePath(`/employer/submissions/${submissionId}`);
    revalidatePath("/employer/submissions");
  }
  if (jobOrderId) {
    revalidatePath("/employer/find-candidates");
    revalidatePath(`/employer/find-candidates/${candidateId}`);
  }
  revalidatePath("/employer/billing");
  return { ok: true, message: "CV unlocked." };
}

/** Spend one CV unlock for a Zoho-synced pool candidate (same wallet, separate unlock table). */
export async function unlockEmployerZohoCvAction(
  zohoCandidateId: string,
  searchRowId: string,
  jobOrderId?: string | null,
): Promise<PlanActionResult> {
  await requireApprovedEmployer();
  if (!jobOrderId) {
    return {
      ok: false,
      error: "Select one of your Direct (Path A) job orders before unlocking.",
    };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("spend_zoho_cv_unlock", {
    p_zoho_candidate_id: zohoCandidateId,
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  revalidatePath("/employer/find-candidates");
  revalidatePath(`/employer/find-candidates/${searchRowId}`);
  revalidatePath("/employer/billing");
  return { ok: true, message: "CV unlocked." };
}
